import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { HttpClient, parseSSE } from "../src/http.js";
import { ArgaError } from "../src/errors.js";

it.each(["json", "text", "error", "sse"])(
  "normalizes %s body timeouts after headers have resolved",
  async (mode) => {
    const server = createServer((_request, response) => {
      response.writeHead(mode === "error" ? 500 : 200, {
        "Content-Type":
          mode === "sse" ? "text/event-stream" : "application/json",
      });
      response.flushHeaders();
      // Keep the body open until the client's deadline aborts it.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test port");
    let headersResolved = false;
    const client = new HttpClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "test",
      timeout: 100,
      fetch: async (...args) => {
        const response = await fetch(...args);
        headersResolved = true;
        return response;
      },
    });
    try {
      const read = async () => {
        if (mode === "text") return client.getText("/body");
        if (mode === "sse") {
          for await (const _event of parseSSE(await client.getRaw("/body"))) {
            // No event is sent before the timeout.
          }
          return;
        }
        return client.get("/body");
      };
      const error = await read().catch((error) => error);
      expect(headersResolved).toBe(true);
      expect(error).toBeInstanceOf(ArgaError);
      expect(error.message).toBe("Arga request timed out after 100ms");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  },
);

it("enforces the deadline when a custom fetch ignores its signal", async () => {
  const client = new HttpClient({
    baseUrl: "https://example.invalid",
    apiKey: "test",
    timeout: 20,
    fetch: () => new Promise(() => {}),
  });
  await expect(client.get("/body")).rejects.toThrow(
    "Arga request timed out after 20ms",
  );
});
it.each(["json", "sse"])(
  "enforces a stalled %s body deadline without transport abort support",
  async (mode) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const client = new HttpClient({
      baseUrl: "https://example.invalid",
      apiKey: "test",
      timeout: 20,
      fetch: async () => response,
    });
    const read = async () => {
      if (mode === "json") return client.get("/body");
      for await (const _event of parseSSE(await client.getRaw("/body"))) {
      }
    };
    await expect(read()).rejects.toThrow("Arga request timed out after 20ms");
    if (mode === "sse") {
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
    }
  },
);
