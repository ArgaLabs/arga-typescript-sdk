import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { CapturePolicy, Projector, READS } from "./projection.js";
import { validateEpisode, type Episode, type Operation } from "./models.js";
import { wrapProvider } from "./adapters.js";
import { stripTrailingSlashes } from "./strings.js";

export interface TracingOptions {
  source: string;
  policy?: CapturePolicy;
  apiKey?: string;
  baseUrl?: string;
  aliasKey?: Uint8Array;
  upload?: boolean;
  queueSize?: number;
  requestTimeout?: number;
  fetch?: typeof globalThis.fetch;
}
export interface EpisodeOptions {
  goal?: string;
  policies?: readonly string[];
  episodeKey?: string;
}
export class EpisodeContext {
  readonly projector: Projector;
  inFlight = 0;
  writesInFlight = 0;
  finished = false;
  constructor(
    readonly tracing: Tracing,
    options: EpisodeOptions,
  ) {
    this.projector = new Projector({
      source: tracing.source,
      episodeKey: options.episodeKey ?? randomUUID(),
      aliasKey: tracing.aliasKey,
      policy: tracing.policy,
    });
    this.projector.setGoal(options.goal, options.policies);
  }
  preview(): Episode {
    return JSON.parse(JSON.stringify(this.projector.episode));
  }
}
export class Tracing {
  readonly source: string;
  readonly policy: CapturePolicy;
  readonly aliasKey: Uint8Array;
  lastEpisode?: Episode;
  private readonly storage = new AsyncLocalStorage<EpisodeContext>();
  private readonly queue: string[] = [];
  private readonly stats: Record<string, number> = {
    queued: 0,
    uploaded: 0,
    failed: 0,
    dropped: 0,
  };
  private readonly receipts: { id: string; trainingPath: string }[] = [];
  private working?: Promise<void>;
  private closed = false;
  readonly #apiKey?: string;
  private readonly baseUrl: string;
  private readonly capacity: number;
  private readonly timeout: number;
  private readonly upload: boolean;
  private readonly fetcher: typeof globalThis.fetch;
  constructor(options: TracingOptions) {
    this.source = options.source;
    this.policy = options.policy ?? new CapturePolicy();
    this.aliasKey = Uint8Array.from(options.aliasKey ?? randomBytes(32));
    this.capacity = options.queueSize ?? 32;
    this.timeout = options.requestTimeout ?? 5000;
    if (
      !Number.isInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 1000 ||
      !Number.isFinite(this.timeout) ||
      this.timeout <= 0 ||
      this.timeout > 60000
    )
      throw new Error("Invalid exporter bounds");
    this.baseUrl = stripTrailingSlashes(
      options.baseUrl ?? "https://api.argalabs.com",
    );
    const url = new URL(this.baseUrl);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error("Use HTTPS for evidence uploads");
    this.upload = options.upload ?? true;
    this.#apiKey = options.apiKey ?? process.env.ARGA_TRACE_KEY;
    if (this.upload && !this.#apiKey)
      throw new Error(
        "Set ARGA_TRACE_KEY or use upload: false for local preview",
      );
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    new Projector({
      source: this.source,
      episodeKey: "config",
      aliasKey: this.aliasKey,
      policy: this.policy,
    });
  }
  /** Run one sync/async agent invocation. No function arguments or output are captured. */
  episode<T>(options: EpisodeOptions, run: (context: EpisodeContext) => T): T {
    if (this.closed) throw new Error("Tracing is closed");
    const context = new EpisodeContext(this, options);
    return this.storage.run(context, () => {
      const finish = (error = false) => {
        if (context.finished) return;
        context.finished = true;
        if (error) context.projector.issue("agent_error");
        if (context.inFlight) context.projector.issue("source_incomplete");
        this.submit(context.projector.episode);
      };
      try {
        const result = run(context);
        if (
          result &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          return Promise.resolve(result).then(
            (value) => {
              finish();
              return value;
            },
            (error) => {
              finish(true);
              throw error;
            },
          ) as T;
        }
        if (result && typeof (result as { next?: unknown }).next === "function")
          context.projector.issue("source_incomplete");
        finish();
        return result;
      } catch (error) {
        finish(true);
        throw error;
      }
    });
  }
  agent<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
    options: {
      goal?: (...args: Args) => string;
      policies?: readonly string[];
    } = {},
  ): (...args: Args) => Result {
    const tracing = this;
    return function (this: unknown, ...args: Args) {
      let goal: string | undefined;
      try {
        goal = options.goal?.(...args);
      } catch {
        /* No raw hook exceptions in diagnostics. */
      }
      return tracing.episode({ goal, policies: options.policies }, () =>
        fn.apply(this, args),
      );
    };
  }
  current(): EpisodeContext | undefined {
    const current = this.storage.getStore();
    return current && !current.finished ? current : undefined;
  }
  start(operation?: Operation): EpisodeContext | undefined {
    const current = this.current();
    if (current) {
      const write = !operation || !READS.has(operation[2]);
      if (current.inFlight && (write || current.writesInFlight))
        current.projector.issue("source_incomplete");
      current.inFlight++;
      if (write) current.writesInFlight++;
    }
    return current;
  }
  end(
    current: EpisodeContext | undefined,
    operation: Operation | undefined,
    parameters: unknown,
    result?: unknown,
    error?: unknown,
  ): void {
    if (!current) return;
    try {
      current.inFlight--;
      if (!operation || !READS.has(operation[2])) current.writesInFlight--;
      if (current.finished) return;
      if (!operation) current.projector.issue("unsupported_operation");
      else current.projector.record(operation, parameters, result, error);
    } catch {
      current.projector.issue("projection_failed");
    }
  }
  wrapStripe<T extends object>(client: T): T {
    return wrapProvider(client, this, "stripe");
  }
  wrapGmail<T extends object>(client: T): T {
    return wrapProvider(client, this, "gmail");
  }
  submit(episode: Episode): boolean {
    try {
      const encoded = JSON.stringify(validateEpisode(episode));
      this.lastEpisode = JSON.parse(encoded);
      if (!this.upload) return true;
      if (
        this.closed ||
        this.queue.length + Number(!!this.working) >= this.capacity
      ) {
        this.stats.dropped++;
        return false;
      }
      this.queue.push(encoded);
      this.stats.queued++;
      // Scheduled after the agent call; queue contains projected, immutable JSON only.
      this.startWorker();
      return true;
    } catch {
      this.stats.dropped++;
      return false;
    }
  }
  private startWorker(): void {
    if (this.working) return;
    this.working = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.working = undefined;
        // A submission may arrive between drain's return and this continuation.
        if (this.queue.length) this.startWorker();
      });
  }
  private async drain(): Promise<void> {
    while (this.queue.length) {
      const payload = this.queue.shift()!;
      this.stats[(await this.send(payload)) ? "uploaded" : "failed"]++;
    }
  }
  private async send(payload: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetcher(
          `${this.baseUrl}/datasets/evidence`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.#apiKey}`,
              "Content-Type": "application/json",
            },
            body: payload,
            redirect: "error",
            signal: AbortSignal.timeout(this.timeout),
          },
        );
        if (response.ok) {
          const result = (await response.json()) as { id?: unknown };
          if (
            typeof result.id !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              result.id,
            )
          )
            return false;
          this.receipts.push({
            id: result.id,
            trainingPath: `/training/${result.id}`,
          });
          if (this.receipts.length > 20) this.receipts.shift();
          return true;
        }
        if (response.status !== 429 && response.status < 500) return false;
      } catch {
        /* Never log HTTP bodies, provider errors or credentials. */
      }
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
    return false;
  }
  async flush(timeout = 5000): Promise<boolean> {
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new Error("Invalid flush timeout");
    const deadline = performance.now() + timeout;
    while (this.queue.length || this.working) {
      this.startWorker();
      const remaining = deadline - performance.now();
      if (remaining <= 0) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const drained = await Promise.race([
          this.working!.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), remaining);
          }),
        ]);
        if (!drained) return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return true;
  }
  async close(timeout = 5000): Promise<boolean> {
    this.closed = true;
    return this.flush(timeout);
  }
  diagnostics(): Record<string, number> {
    return { ...this.stats };
  }
  recentUploads(): { id: string; trainingPath: string }[] {
    return this.receipts.map((receipt) => ({ ...receipt }));
  }
}
export function initTracing(options: TracingOptions): Tracing {
  return new Tracing(options);
}
