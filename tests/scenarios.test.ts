import { describe, it, expect, vi } from "vitest";
import { Arga } from "../src/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(response: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
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

describe("ScenariosResource", () => {
  // ---- create -------------------------------------------------------------

  describe("create", () => {
    it("sends POST to /scenarios with correct body and parses Scenario response", async () => {
      const apiResponse = {
        id: "scen_001",
        name: "Login Flow",
        description: "Tests the complete login flow",
        prompt: "Verify user can log in with valid credentials",
        twins: ["stripe"],
        seed_config: { user_count: 10 },
        tags: ["auth", "critical"],
        created_at: "2026-01-15T10:00:00Z",
        updated_at: "2026-01-15T10:00:00Z",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.scenarios.create({
        name: "Login Flow",
        description: "Tests the complete login flow",
        prompt: "Verify user can log in with valid credentials",
        twins: ["stripe"],
        seedConfig: { userCount: 10 },
        tags: ["auth", "critical"],
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/scenarios");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer arga_test_key");

      const body = JSON.parse(opts.body);
      expect(body.name).toBe("Login Flow");
      expect(body.description).toBe("Tests the complete login flow");
      expect(body.prompt).toBe("Verify user can log in with valid credentials");
      expect(body.twins).toEqual(["stripe"]);
      expect(body.seed_config).toEqual({ user_count: 10 });
      expect(body.tags).toEqual(["auth", "critical"]);
      // camelCase should not be present in request
      expect(body.seedConfig).toBeUndefined();

      // Response should be camelCase
      expect(result.id).toBe("scen_001");
      expect(result.name).toBe("Login Flow");
      expect(result.seedConfig).toEqual({ userCount: 10 });
      expect(result.createdAt).toBe("2026-01-15T10:00:00Z");
      expect(result.updatedAt).toBe("2026-01-15T10:00:00Z");
    });
  });

  // ---- list ---------------------------------------------------------------

  describe("list", () => {
    it("sends GET to /scenarios with query params", async () => {
      const apiResponse = [
        {
          id: "scen_001",
          name: "Login Flow",
          tags: ["auth"],
          created_at: "2026-01-15T10:00:00Z",
        },
        {
          id: "scen_002",
          name: "Payment Flow",
          tags: ["billing"],
          created_at: "2026-01-16T10:00:00Z",
        },
      ];
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.scenarios.list({
        twin: "stripe",
        tag: "billing",
      });

      const [url, opts] = fetch.mock.calls[0];
      // URL should include query params
      const parsedUrl = new URL(url);
      expect(parsedUrl.pathname).toBe("/scenarios");
      expect(parsedUrl.searchParams.get("twin")).toBe("stripe");
      expect(parsedUrl.searchParams.get("tag")).toBe("billing");
      expect(opts.method).toBe("GET");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("scen_001");
      expect(result[0].createdAt).toBe("2026-01-15T10:00:00Z");
      expect(result[1].id).toBe("scen_002");
    });

    it("sends GET to /scenarios without query params when none provided", async () => {
      const apiResponse: unknown[] = [];
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      await client.scenarios.list();

      const [url] = fetch.mock.calls[0];
      const parsedUrl = new URL(url);
      expect(parsedUrl.pathname).toBe("/scenarios");
      expect(parsedUrl.search).toBe("");
    });
  });

  // ---- get ----------------------------------------------------------------

  describe("get", () => {
    it("sends GET to /scenarios/{id} and parses Scenario", async () => {
      const apiResponse = {
        id: "scen_001",
        name: "Login Flow",
        description: "Tests the complete login flow",
        prompt: "Verify login",
        twins: ["stripe", "github"],
        seed_config: { user_count: 5 },
        tags: ["auth"],
        created_at: "2026-01-15T10:00:00Z",
        updated_at: "2026-01-16T12:00:00Z",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.scenarios.get("scen_001");

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/scenarios/scen_001");
      expect(opts.method).toBe("GET");

      expect(result.id).toBe("scen_001");
      expect(result.name).toBe("Login Flow");
      expect(result.description).toBe("Tests the complete login flow");
      expect(result.seedConfig).toEqual({ userCount: 5 });
      expect(result.createdAt).toBe("2026-01-15T10:00:00Z");
      expect(result.updatedAt).toBe("2026-01-16T12:00:00Z");
    });
  });
});
