import { ArgaAPIError, ArgaError } from "./errors.js";

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

/** Recursively convert all object keys using the supplied key mapper. */
function convertKeys(
  obj: unknown,
  mapper: (key: string) => string,
): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeys(item, mapper));
  }
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[mapper(key)] = convertKeys(value, mapper);
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
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(opts: HttpClientOptions) {
    // Strip trailing slash from base URL
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this._fetch = opts.fetch;
  }

  // ---- public helpers -----------------------------------------------------

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, query);
    const res = await this._fetch(url, {
      method: "GET",
      headers: this.headers(),
    });
    return this.handleResponse<T>(res);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this._fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(toSnakeCaseKeys(body)) : undefined,
    });
    return this.handleResponse<T>(res);
  }

  /**
   * Perform a GET request and return the raw Response, for SSE streaming.
   */
  async getRaw(path: string): Promise<Response> {
    const url = this.buildUrl(path);
    const res = await this._fetch(url, {
      method: "GET",
      headers: {
        ...this.headers(),
        Accept: "text/event-stream",
      },
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
      body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
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
