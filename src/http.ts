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
    if (!Number.isFinite(this.timeout) || this.timeout <= 0)
      throw new ArgaError("Invalid request timeout");
  }

  // ---- public helpers -----------------------------------------------------

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, query);
    const res = await this._fetch(url, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "error",
    });
    return this.handleResponse<T>(res);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this._fetch(url, {
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
    const res = await this._fetch(url, {
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
      await this._fetch(this.buildUrl(path), {
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
      await this._fetch(this.buildUrl("/datasets/evidence"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
        redirect: "error",
      }),
    );
  }
  async getText(path: string): Promise<string> {
    const res = await this._fetch(this.buildUrl(path), {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "error",
    });
    if (!res.ok) await this.throwApiError(res);
    return res.text();
  }
  async getRedirect(path: string): Promise<string> {
    const res = await this._fetch(this.buildUrl(path), {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(res.status) && location)
      return new URL(location, this.baseUrl).toString();
    if (!res.ok) await this.throwApiError(res);
    throw new ArgaError("Artifact response did not include a redirect");
  }

  /**
   * Perform a GET request and return the raw Response, for SSE streaming.
   */
  async getRaw(path: string): Promise<Response> {
    const url = this.buildUrl(path);
    const res = await this._fetch(url, {
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
    const json = await res.json();
    return toCamelCaseKeys(json) as T;
  }

  private async throwApiError(res: Response): Promise<never> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
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
      const { done, value } = await reader.read();
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
  } finally {
    reader.releaseLock();
  }
}
