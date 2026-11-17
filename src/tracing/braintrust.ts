import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, rename, unlink, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { operationFor } from "./adapters.js";
import {
  CapturePolicy,
  Projector,
  READS,
  sha256,
  stableJson,
  value,
} from "./projection.js";
import { validateEpisode, type Episode } from "./models.js";

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}
export interface TraceProjectionOptions {
  source: string;
  projectId: string;
  aliasKey: Uint8Array;
  policy?: CapturePolicy;
  goalPointer?: string;
  policies?: readonly string[];
  operations?: Readonly<Record<string, string>>;
}
export type BraintrustRow = Record<string, unknown>;
function pointer(document: unknown, path: string): unknown {
  if (!path) return document;
  if (!path.startsWith("/")) throw new SyncError("Use a JSON pointer");
  let current = document;
  for (const part of path.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function finite(item: unknown): item is number {
  return typeof item === "number" && Number.isFinite(item);
}
export function projectTrace(
  rows: readonly BraintrustRow[],
  options: TraceProjectionOptions,
): Episode {
  if (!rows.length || rows.length > 1000)
    throw new SyncError("Select a complete trace with at most 1,000 spans");
  const spans = new Map<string, BraintrustRow>(),
    traceIds = new Set<string>();
  for (const row of rows) {
    const spanId = row.span_id ?? row.id,
      traceId = row.root_span_id ?? row.trace_id;
    if (
      typeof spanId !== "string" ||
      typeof traceId !== "string" ||
      !spanId ||
      !traceId
    )
      throw new SyncError("Invalid Braintrust trace identifiers");
    if (spans.has(spanId) && stableJson(spans.get(spanId)) !== stableJson(row))
      throw new SyncError("Conflicting Braintrust span revisions");
    spans.set(spanId, row);
    traceIds.add(traceId);
  }
  const roots = [...spans.values()].filter(
    (row) =>
      !row.span_parents ||
      (Array.isArray(row.span_parents) && !row.span_parents.length),
  );
  if (traceIds.size !== 1 || roots.length !== 1)
    throw new SyncError("Select one complete trace tree");
  const remaining = new Map<string, Set<string>>();
  for (const [id, row] of spans) {
    const parents = row.span_parents ?? [];
    if (
      !Array.isArray(parents) ||
      parents.some((parent) => typeof parent !== "string" || !spans.has(parent))
    )
      throw new SyncError("Braintrust trace has missing parents");
    remaining.set(id, new Set(parents));
  }
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, parents]) => !parents.size)
      .map(([id]) => id);
    if (!ready.length)
      throw new SyncError("Braintrust trace has cyclic parents");
    for (const id of ready) {
      remaining.delete(id);
      for (const parents of remaining.values()) parents.delete(id);
    }
  }
  const projector = new Projector({
    source: options.source,
    episodeKey: `${options.projectId}:${[...traceIds][0]}`,
    aliasKey: options.aliasKey,
    policy: options.policy ?? new CapturePolicy(),
    origin: "braintrust",
  });
  projector.setGoal(
    pointer(roots[0], options.goalPointer ?? "/input"),
    options.policies,
  );
  if (!finite(value(roots[0].metrics, "end")))
    projector.issue("source_incomplete");
  const mapped: {
    start: number;
    end: number;
    span: BraintrustRow;
    operation: NonNullable<ReturnType<typeof operationFor>>;
  }[] = [];
  for (const span of spans.values()) {
    if (span === roots[0]) continue;
    const type = value(span.span_attributes, "type"),
      name = value(span.span_attributes, "name");
    if (["llm", "score", "eval"].includes(String(type))) continue;
    const operation =
      typeof name === "string"
        ? operationFor(options.operations?.[name] ?? name)
        : undefined;
    if (!operation) {
      if (type === "tool") projector.issue("unsupported_operation");
      continue;
    }
    const start = value(span.metrics, "start"),
      end = value(span.metrics, "end");
    if (!finite(start) || !finite(end)) projector.issue("source_incomplete");
    mapped.push({
      start: finite(start) ? start : 0,
      end: finite(end) ? end : 0,
      span,
      operation,
    });
  }
  mapped.sort(
    (a, b) =>
      a.start - b.start ||
      String(a.span.span_id).localeCompare(String(b.span.span_id)),
  );
  let active: { end: number; write: boolean }[] = [];
  for (const { start, end, span, operation } of mapped) {
    const write = !READS.has(operation[2]);
    active = active.filter((item) => item.end > start);
    if (end < start || active.some((item) => write || item.write))
      projector.issue("source_incomplete");
    active.push({ end, write });
    const error =
      span.error && typeof span.error !== "object"
        ? { code: "other" }
        : span.error;
    projector.record(operation, span.input ?? {}, span.output, error);
  }
  return validateEpisode(projector.episode);
}
export interface BraintrustSyncOptions {
  source: string;
  projectId: string;
  braintrustKey: string;
  argaKey: string;
  statePath: string;
  since: Date;
  policy?: CapturePolicy;
  region?: "us" | "eu";
  baseUrl?: string;
  goalPointer?: string;
  policies?: readonly string[];
  operations?: Readonly<Record<string, string>>;
  windowMs?: number;
  lookbackMs?: number;
  fetch?: typeof globalThis.fetch;
}
export interface SyncCounters {
  uploaded: number;
  unchanged: number;
  pending: number;
  coverageGaps: number;
  caughtUp: boolean;
}
interface Checkpoint {
  version: 1;
  identity: string;
  alias_key: string;
  watermark: string;
  pending: Record<string, string>;
  acknowledged: Record<string, { digest: string; created: string }>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function validDate(text: unknown): text is string {
  return (
    typeof text === "string" &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(text) &&
    Number.isFinite(Date.parse(text))
  );
}
function literal(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}
export class BraintrustSync {
  readonly source: string;
  readonly projectId: string;
  readonly statePath: string;
  private readonly policy: CapturePolicy;
  private readonly since: number;
  private readonly window: number;
  private readonly lookback: number;
  private readonly goalPointer: string;
  private readonly policies: readonly string[];
  private readonly operations: Readonly<Record<string, string>>;
  private readonly region: "us" | "eu";
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly identity: string;
  #braintrustKey: string;
  #argaKey: string;
  constructor(options: BraintrustSyncOptions) {
    if (!UUID.test(options.projectId))
      throw new Error("Invalid Braintrust project ID");
    this.projectId = options.projectId.toLowerCase();
    this.source = options.source;
    this.policy = options.policy ?? new CapturePolicy();
    this.statePath = resolve(options.statePath);
    this.since = options.since.getTime();
    this.window = options.windowMs ?? 300000;
    this.lookback = options.lookbackMs ?? 120000;
    if (
      ![this.since, this.window, this.lookback].every(Number.isFinite) ||
      this.window <= 0 ||
      this.window > 3600000 ||
      this.lookback < 0 ||
      this.lookback >= this.window
    )
      throw new Error(
        "Use a valid start and bounded window larger than lookback",
      );
    this.region = options.region ?? "us";
    if (!["us", "eu"].includes(this.region))
      throw new Error("Invalid Braintrust region");
    this.baseUrl = (options.baseUrl ?? "https://api.argalabs.com").replace(
      /\/+$/,
      "",
    );
    const destination = new URL(this.baseUrl);
    if (
      destination.protocol !== "https:" ||
      destination.username ||
      destination.password
    )
      throw new Error("Use HTTPS for Arga sync");
    this.goalPointer = options.goalPointer ?? "/input";
    if (this.goalPointer && !this.goalPointer.startsWith("/"))
      throw new Error("Use a JSON pointer");
    this.policies = Object.freeze([...(options.policies ?? [])]);
    this.operations = Object.freeze({ ...options.operations });
    if (Object.values(this.operations).some((name) => !operationFor(name)))
      throw new Error("Mappings must target supported canonical operations");
    new Projector({
      source: this.source,
      episodeKey: "config",
      aliasKey: Buffer.alloc(32),
      policy: this.policy,
    });
    this.#braintrustKey = options.braintrustKey;
    this.#argaKey = options.argaKey;
    if (!this.#braintrustKey || !this.#argaKey)
      throw new Error("Provide Braintrust read and Arga upload credentials");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    let owner = sha256(options.argaKey);
    if (options.argaKey.startsWith("arga_trace_")) {
      try {
        const claims = JSON.parse(
          Buffer.from(
            options.argaKey.slice(11).split(".")[1],
            "base64url",
          ).toString(),
        );
        if (!UUID.test(claims.sub)) throw new Error();
        owner = claims.sub;
      } catch {
        throw new Error("Invalid scoped Arga key");
      }
    }
    this.identity = sha256(
      stableJson({
        source: this.source,
        project_id: this.projectId,
        policy: this.policy.fingerprint,
        goal_pointer: this.goalPointer,
        policies: this.policies,
        operations: this.operations,
        region: this.region,
        since: new Date(this.since).toISOString(),
        destination: this.baseUrl,
        owner,
      }),
    );
  }
  private async query(query: string): Promise<BraintrustRow[]> {
    const rows: BraintrustRow[] = [],
      seen = new Set<string>();
    let cursor: string | null = null,
      totalBytes = 0;
    try {
      for (let page = 0; page < 100; page++) {
        const response: Response = await this.fetcher(
          `${this.region === "eu" ? "https://api-eu.braintrust.dev" : "https://api.braintrust.dev"}/btql`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.#braintrustKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: query + (cursor ? ` OFFSET ${literal(cursor)}` : ""),
              fmt: "json",
            }),
            redirect: "error",
            signal: AbortSignal.timeout(35000),
          },
        );
        if (!response.ok || !response.body) throw new Error();
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            totalBytes += next.value.length;
            if (totalBytes > 2000000) {
              await reader.cancel();
              throw new SyncError(
                "Braintrust response exceeds the local limit; reduce the window",
              );
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        const data = JSON.parse(Buffer.concat(chunks).toString()).data;
        if (
          !Array.isArray(data) ||
          data.some(
            (row) => !row || typeof row !== "object" || Array.isArray(row),
          )
        )
          throw new SyncError("Invalid Braintrust response");
        rows.push(...data);
        if (rows.length > 1000)
          throw new SyncError(
            "Braintrust selection exceeds the local limit; reduce the window",
          );
        cursor =
          response.headers.get("x-bt-cursor") ??
          response.headers.get("x-amz-meta-bt_cursor");
        if (!cursor) return rows;
        if (seen.has(cursor))
          throw new SyncError("Braintrust repeated a pagination cursor");
        seen.add(cursor);
      }
      throw new SyncError("Braintrust pagination did not finish");
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError(
        "Braintrust read failed; verify project, region and read credentials",
      );
    }
  }
  private async save(state: Checkpoint): Promise<void> {
    const encoded = JSON.stringify(state);
    if (Buffer.byteLength(encoded) > 2000000)
      throw new SyncError("Checkpoint exceeds its local limit");
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(encoded);
      await file.sync();
      await file.close();
      await rename(temporary, this.statePath);
      await chmod(this.statePath, 0o600);
    } finally {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
  private async load(): Promise<Checkpoint> {
    try {
      const file = await open(
        this.statePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 2000000) throw new Error();
        const state = JSON.parse(await file.readFile("utf8")) as Checkpoint;
        if (state.identity !== this.identity)
          throw new SyncError(
            "Sync configuration changed; use a new checkpoint",
          );
        if (
          state.version !== 1 ||
          !/^[a-f0-9]{64}$/.test(state.alias_key) ||
          !validDate(state.watermark) ||
          !state.pending ||
          typeof state.pending !== "object" ||
          Array.isArray(state.pending) ||
          Object.keys(state.pending).length > 1000 ||
          !state.acknowledged ||
          typeof state.acknowledged !== "object" ||
          Array.isArray(state.acknowledged)
        )
          throw new Error();
        for (const [id, date] of Object.entries(state.pending))
          if (!id || !validDate(date)) throw new Error();
        for (const [id, receipt] of Object.entries(state.acknowledged))
          if (
            !/^[a-f0-9]{32}$/.test(id) ||
            !receipt ||
            !/^[a-f0-9]{64}$/.test(receipt.digest) ||
            !validDate(receipt.created)
          )
            throw new Error();
        return state;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof SyncError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new SyncError("Invalid local checkpoint");
      const state: Checkpoint = {
        version: 1,
        identity: this.identity,
        alias_key: randomBytes(32).toString("hex"),
        watermark: new Date(this.since).toISOString(),
        pending: {},
        acknowledged: {},
      };
      await this.save(state);
      return state;
    }
  }
  async syncOnce(options: { until?: Date } = {}): Promise<SyncCounters> {
    const until = options.until?.getTime() ?? Date.now() - 30000;
    if (!Number.isFinite(until)) throw new Error("Use a valid end date");
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    const lockPath = `${this.statePath}.lock`;
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch {
      throw new SyncError(
        "Checkpoint is locked; verify no other worker is running before removing a stale lock",
      );
    }
    try {
      const state = await this.load(),
        watermark = Date.parse(state.watermark);
      const start = Math.max(this.since, watermark - this.lookback),
        end = Math.min(until, watermark + this.window);
      const counters: SyncCounters = {
        uploaded: 0,
        unchanged: 0,
        pending: Object.keys(state.pending).length,
        coverageGaps: 0,
        caughtUp: true,
      };
      if (end <= start) return counters;
      const roots = await this.query(
        `SELECT root_span_id, created FROM project_logs(${literal(this.projectId)}) WHERE is_root = true AND created >= ${literal(new Date(start).toISOString())} AND created < ${literal(new Date(end).toISOString())} ORDER BY created ASC`,
      );
      const selected = new Map<unknown, BraintrustRow>(
        roots.map((root) => [root.root_span_id, root]),
      );
      for (const [id, created] of Object.entries(state.pending))
        if (!selected.has(id)) selected.set(id, { root_span_id: id, created });
      const pend = (id: string, created: string) => {
        Object.defineProperty(state.pending, id, {
          value: created,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        if (Object.keys(state.pending).length > 1000)
          throw new SyncError(
            "Too many unresolved roots; resolve or backfill this source",
          );
      };
      for (const root of selected.values()) {
        const traceId = root.root_span_id;
        if (typeof traceId !== "string" || !traceId || !validDate(root.created))
          throw new SyncError("Invalid Braintrust root record");
        const created = new Date(root.created).toISOString();
        const rows = await this.query(
          `SELECT span_id, root_span_id, span_parents, span_attributes, input, output, error, metrics FROM project_logs(${literal(this.projectId)}) WHERE root_span_id = ${literal(traceId)}`,
        );
        const rootSpans = rows.filter(
          (row) =>
            !row.span_parents ||
            (Array.isArray(row.span_parents) && !row.span_parents.length),
        );
        if (
          rootSpans.length === 1 &&
          !finite(value(rootSpans[0].metrics, "end"))
        ) {
          pend(traceId, created);
          continue;
        }
        let episode: Episode, encoded: string;
        try {
          episode = projectTrace(rows, {
            source: this.source,
            projectId: this.projectId,
            aliasKey: Buffer.from(state.alias_key, "hex"),
            policy: this.policy,
            goalPointer: this.goalPointer,
            policies: this.policies,
            operations: this.operations,
          });
          encoded = stableJson(episode);
        } catch {
          pend(traceId, created);
          counters.coverageGaps++;
          continue;
        }
        const digest = sha256(encoded);
        if (state.acknowledged[episode.episode_id]?.digest === digest) {
          delete state.pending[traceId];
          counters.unchanged++;
          continue;
        }
        try {
          const response = await this.fetcher(
            `${this.baseUrl}/datasets/evidence`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.#argaKey}`,
                "Content-Type": "application/json",
              },
              body: encoded,
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            },
          );
          if (
            !response.ok ||
            !UUID.test(((await response.json()) as { id: string }).id)
          )
            throw new Error();
        } catch {
          throw new SyncError(
            "Arga upload was not acknowledged; checkpoint was not advanced",
          );
        }
        state.acknowledged[episode.episode_id] = { digest, created };
        delete state.pending[traceId];
        await this.save(state);
        counters.uploaded++;
      }
      state.watermark = new Date(Math.max(watermark, end)).toISOString();
      const cutoff = Math.max(this.since, end - this.lookback);
      state.acknowledged = Object.fromEntries(
        Object.entries(state.acknowledged).filter(
          ([, receipt]) => Date.parse(receipt.created) >= cutoff,
        ),
      );
      await this.save(state);
      return {
        ...counters,
        pending: Object.keys(state.pending).length,
        caughtUp: end >= until,
      };
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
