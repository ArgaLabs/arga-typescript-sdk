import { ArgaAPIError, ArgaError } from "./errors.js";
import { stripTrailingSlashes } from "./tracing/strings.js";

// ---------------------------------------------------------------------------
// Case conversion helpers
// ---------------------------------------------------------------------------

/** Convert a camelCase string to snake_case. */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/** Convert a snake_case string to camelCase. */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

const OPAQUE_KEYS = new Set([
  "seed_config",
  "seedConfig",
  "test_config",
  "testConfig",
  "test_config_json",
  "testConfigJson",
  "credentials",
  "env_vars",
  "envVars",
  "spec",
  "before",
  "after",
  "payload",
  "grader_artifact",
  "graderArtifact",
  "grader",
  "example",
  "traces",
  "snapshots",
  "seed_results",
  "seedResults",
  "factory_reset",
  "factoryReset",
]);

/** Recursively convert model keys, preserving customer JSON documents. */
function convertKeys(obj: unknown, mapper: (key: string) => string): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeys(item, mapper));
  }
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // These are customer/provider-owned documents, not SDK model fields.
      result[mapper(key)] = OPAQUE_KEYS.has(key)
        ? value
        : key === "twins" &&
            value &&
            !Array.isArray(value) &&
            typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([name, twin]) => [
                name,
                convertKeys(twin, mapper),
              ]),
            )
          : convertKeys(value, mapper);
    }
    return result;
  }
  return obj;
}

/** Convert all keys in an object tree from camelCase to snake_case. */
export function toSnakeCaseKeys(obj: unknown): unknown {
  return convertKeys(obj, toSnakeCase);
}

/** Convert all keys in an object tree from snake_case to camelCase. */
export function toCamelCaseKeys(obj: unknown): unknown {
  return convertKeys(obj, toCamelCase);
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  timeout?: number;
}

interface RequestContext {
  timeout: number;
  signal?: AbortSignal;
}
const responseContexts = new WeakMap<Response, RequestContext>();
function requestError(error: unknown, context?: RequestContext): unknown {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      (error.name === "AbortError" &&
        context?.signal?.reason?.name === "TimeoutError"))
  )
    return new ArgaError(
      `Arga request timed out${context ? ` after ${context.timeout}ms` : ""}`,
    );
  return error;
}
async function withinDeadline<T>(
  context: RequestContext | undefined,
  read: () => Promise<T>,
): Promise<T> {
  const signal = context?.signal;
  let abort: (() => void) | undefined;
  try {
    if (!signal) return await read();
    const deadline = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    if (signal.aborted) throw signal.reason;
    // Retain the signal and observe its deadline through the complete read,
    // even when the transport does not reject a stalled body on abort.
    return await Promise.race([read(), deadline]);
  } catch (error) {
    throw requestError(error, context);
  } finally {
    if (signal && abort) signal.removeEventListener("abort", abort);
  }
}
function readBody<T>(response: Response, read: () => Promise<T>): Promise<T> {
  return withinDeadline(responseContexts.get(response), read);
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly timeout: number;

  constructor(opts: HttpClientOptions) {
    // Strip trailing slash from base URL
    this.baseUrl = stripTrailingSlashes(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this._fetch = opts.fetch;
    this.timeout = opts.timeout ?? 300_000;
    if (
      !Number.isInteger(this.timeout) ||
      this.timeout <= 0 ||
      this.timeout > 2147483647
    )
      throw new ArgaError("Invalid request timeout");
  }

  private async performFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const context = { timeout: this.timeout, signal: init.signal ?? undefined };
    const response = await withinDeadline(context, () =>
      this._fetch(url, init),
    );
    responseContexts.set(response, context);
    return response;
  }

  // ---- public helpers -----------------------------------------------------

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, query);
    const res = await this.performFetch(url, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "error",
    });
    return this.handleResponse<T>(res);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this.performFetch(url, {
      method: "POST",
      headers: this.headers(),
      body:
        body !== undefined ? JSON.stringify(toSnakeCaseKeys(body)) : undefined,
      signal: AbortSignal.timeout(this.timeout),
      redirect: "error",
    });
    return this.handleResponse<T>(res);
  }

  async delete<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this.performFetch(url, {
      method: "DELETE",
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "error",
    });
    return this.handleResponse<T>(res);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.update("PUT", path, body);
  }
  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.update("PATCH", path, body);
  }
  private async update<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.handleResponse<T>(
      await this.performFetch(this.buildUrl(path), {
        method,
        headers: this.headers(),
        body: JSON.stringify(toSnakeCaseKeys(body)),
        signal: AbortSignal.timeout(this.timeout),
        redirect: "error",
      }),
    );
  }
  /** Raw evidence has its own strict snake_case contract. Never transform its keys. */
  async postEvidence<T>(payload: unknown): Promise<T> {
    return this.handleResponse<T>(
      await this.performFetch(this.buildUrl("/datasets/evidence"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
        redirect: "error",
      }),
    );
  }
  async getText(path: string): Promise<string> {
    const res = await this.performFetch(this.buildUrl(path), {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "error",
    });
    if (!res.ok) await this.throwApiError(res);
    return readBody(res, () => res.text());
  }
  async getRedirect(path: string): Promise<string> {
    const res = await this.performFetch(this.buildUrl(path), {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(res.status) && location)
      return new URL(location, this.buildUrl(path)).toString();
    if (!res.ok) await this.throwApiError(res);
    throw new ArgaError("Artifact response did not include a redirect");
  }

  /**
   * Perform a GET request and return the raw Response, for SSE streaming.
   */
  async getRaw(path: string): Promise<Response> {
    const url = this.buildUrl(path);
    const res = await this.performFetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(this.timeout),
      headers: {
        ...this.headers(),
        Accept: "text/event-stream",
      },
      redirect: "error",
    });
    if (!res.ok) {
      await this.throwApiError(res);
    }
    return res;
  }

  // ---- internals ----------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }
    return url.toString();
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      await this.throwApiError(res);
    }
    if (res.status === 204) return undefined as T;
    const json = await readBody(res, () => res.json());
    return toCamelCaseKeys(json) as T;
  }

  private async throwApiError(res: Response): Promise<never> {
    const text = await readBody(res, () => res.text());
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep a non-JSON error body without trying to consume the stream twice.
    }

    const detail =
      body &&
      typeof body === "object" &&
      "detail" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).detail)
        : `HTTP ${res.status}`;

    throw new ArgaAPIError(detail, res.status, res, body);
  }
}

// ---------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Parse a fetch Response body as a Server-Sent Events stream.
 * Yields individual SSE events as they arrive.
 */
export async function* parseSSE(response: Response): AsyncIterable<SSEEvent> {
  const body = response.body;
  if (!body) {
    throw new ArgaError("Response body is null — cannot stream SSE");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: string | undefined;
  let currentData: string[] = [];

  try {
    while (true) {
      const { done, value } = await readBody(response, () => reader.read());
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          // Empty line = end of event
          if (currentData.length > 0) {
            yield {
              event: currentEvent,
              data: currentData.join("\n"),
            };
          }
          currentEvent = undefined;
          currentData = [];
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData.push(line.slice(5).trim());
        }
        // Ignore comments (lines starting with ':') and unknown fields
      }
    }

    // Flush any remaining event
    if (currentData.length > 0) {
      yield {
        event: currentEvent,
        data: currentData.join("\n"),
      };
    }
  } catch (error) {
    // A raced deadline can leave a read pending; cancel it before releasing.
    void reader.cancel().catch(() => {});
    throw requestError(error, responseContexts.get(response));
  } finally {
    reader.releaseLock();
  }
}
