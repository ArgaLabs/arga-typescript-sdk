import { describe, it, expect, vi } from "vitest";
import { Arga } from "../src/client.js";
import { ArgaAPIError } from "../src/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(responseBody: unknown, status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(responseBody),
    text: () => Promise.resolve(JSON.stringify(responseBody)),
  } as unknown as Response);
}

function createClient(fetch: ReturnType<typeof vi.fn>) {
  return new Arga({
    apiKey: "arga_test_key",
    baseUrl: "https://api.test.com",
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Error handling", () => {
  it("throws ArgaAPIError with statusCode 401 on unauthorized", async () => {
    const fetch = mockFetch({ detail: "Invalid API key" }, 401);
    const client = createClient(fetch);

    await expect(client.runs.get("run_123")).rejects.toThrow(ArgaAPIError);

    try {
      await client.runs.get("run_123");
    } catch (err) {
      const apiError = err as ArgaAPIError;
      expect(apiError).toBeInstanceOf(ArgaAPIError);
      expect(apiError.statusCode).toBe(401);
      expect(apiError.message).toBe("Invalid API key");
      expect(apiError.name).toBe("ArgaAPIError");
    }
  });

  it("throws ArgaAPIError with statusCode 404 on not found", async () => {
    const fetch = mockFetch({ detail: "Run not found" }, 404);
    const client = createClient(fetch);

    await expect(client.runs.get("nonexistent")).rejects.toThrow(ArgaAPIError);

    try {
      await client.runs.get("nonexistent");
    } catch (err) {
      const apiError = err as ArgaAPIError;
      expect(apiError).toBeInstanceOf(ArgaAPIError);
      expect(apiError.statusCode).toBe(404);
      expect(apiError.message).toBe("Run not found");
    }
  });

  it("throws ArgaAPIError with statusCode 500 on server error", async () => {
    const fetch = mockFetch({ detail: "Internal server error" }, 500);
    const client = createClient(fetch);

    await expect(client.twins.list()).rejects.toThrow(ArgaAPIError);

    try {
      await client.twins.list();
    } catch (err) {
      const apiError = err as ArgaAPIError;
      expect(apiError).toBeInstanceOf(ArgaAPIError);
      expect(apiError.statusCode).toBe(500);
      expect(apiError.message).toBe("Internal server error");
    }
  });

  it("falls back to HTTP status code message when detail is absent", async () => {
    const fetch = mockFetch({ error: "something went wrong" }, 503);
    const client = createClient(fetch);

    try {
      await client.scenarios.list();
    } catch (err) {
      const apiError = err as ArgaAPIError;
      expect(apiError).toBeInstanceOf(ArgaAPIError);
      expect(apiError.statusCode).toBe(503);
      expect(apiError.message).toBe("HTTP 503");
      expect(apiError.body).toEqual({ error: "something went wrong" });
    }
  });

  it("preserves the response body on the error object", async () => {
    const responseBody = {
      detail: "Rate limit exceeded",
      retry_after: 30,
    };
    const fetch = mockFetch(responseBody, 429);
    const client = createClient(fetch);

    try {
      await client.runs.createUrlRun({ url: "https://example.com" });
    } catch (err) {
      const apiError = err as ArgaAPIError;
      expect(apiError.statusCode).toBe(429);
      expect(apiError.message).toBe("Rate limit exceeded");
      expect(apiError.body).toEqual(responseBody);
    }
  });

  it("handles POST endpoints throwing errors", async () => {
    const fetch = mockFetch({ detail: "Forbidden" }, 403);
    const client = createClient(fetch);

    await expect(
      client.twins.provision({ twins: ["stripe"] }),
    ).rejects.toThrow(ArgaAPIError);

    try {
      await client.twins.provision({ twins: ["stripe"] });
    } catch (err) {
      const apiError = err as ArgaAPIError;
      expect(apiError.statusCode).toBe(403);
      expect(apiError.message).toBe("Forbidden");
    }
  });
});
