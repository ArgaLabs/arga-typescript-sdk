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

describe("TwinsResource", () => {
  // ---- list ---------------------------------------------------------------

  describe("list", () => {
    it("sends GET to /validate/twins and parses Twin[] with camelCase", async () => {
      const apiResponse = [
        {
          name: "stripe",
          label: "Stripe",
          kind: "unified",
          show_in_ui: true,
        },
        {
          name: "github",
          label: "GitHub",
          kind: "box",
          show_in_ui: false,
        },
      ];
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.twins.list();

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/twins");
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe("Bearer arga_test_key");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("stripe");
      expect(result[0].label).toBe("Stripe");
      expect(result[0].kind).toBe("unified");
      expect(result[0].showInUi).toBe(true);
      expect(result[1].name).toBe("github");
      expect(result[1].showInUi).toBe(false);
    });
  });

  // ---- provision ----------------------------------------------------------

  describe("provision", () => {
    it("sends POST to /validate/twins/provision with snake_case body", async () => {
      const apiResponse = { run_id: "run_twin_001" };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.twins.provision({
        twins: ["stripe", "github"],
        ttlMinutes: 60,
        scenarioId: "scen_abc",
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/twins/provision");
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.twins).toEqual(["stripe", "github"]);
      expect(body.ttl_minutes).toBe(60);
      expect(body.scenario_id).toBe("scen_abc");
      // camelCase should not be in request body
      expect(body.ttlMinutes).toBeUndefined();
      expect(body.scenarioId).toBeUndefined();

      expect(result.runId).toBe("run_twin_001");
    });
  });

  // ---- getStatus ----------------------------------------------------------

  describe("getStatus", () => {
    it("sends GET to /validate/twins/provision/{runId}/status and parses nested TwinInstance", async () => {
      const apiResponse = {
        run_id: "run_twin_001",
        status: "ready",
        twins: {
          stripe: {
            name: "stripe",
            label: "Stripe",
            base_url: "https://stripe-twin.arga.run",
            admin_url: "https://stripe-twin.arga.run/admin",
            env_vars: {
              STRIPE_API_KEY: "sk_test_twin_123",
              STRIPE_WEBHOOK_SECRET: "whsec_twin_456",
            },
            show_in_ui: true,
          },
          github: {
            name: "github",
            label: "GitHub",
            base_url: "https://github-twin.arga.run",
            admin_url: "https://github-twin.arga.run/admin",
            env_vars: { GITHUB_TOKEN: "ght_twin_789" },
            show_in_ui: false,
          },
        },
        dashboard_url: "https://dashboard.arga.run/run_twin_001",
        expires_at: "2026-01-15T11:00:00Z",
        proxy_token: "proxy_abc",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.twins.getStatus("run_twin_001");

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe(
        "https://api.test.com/validate/twins/provision/run_twin_001/status",
      );
      expect(opts.method).toBe("GET");

      expect(result.runId).toBe("run_twin_001");
      expect(result.status).toBe("ready");
      expect(result.dashboardUrl).toBe(
        "https://dashboard.arga.run/run_twin_001",
      );
      expect(result.expiresAt).toBe("2026-01-15T11:00:00Z");
      expect(result.proxyToken).toBe("proxy_abc");

      // Nested twin instances should have camelCase keys
      const stripe = result.twins.stripe;
      expect(stripe.name).toBe("stripe");
      expect(stripe.baseUrl).toBe("https://stripe-twin.arga.run");
      expect(stripe.adminUrl).toBe("https://stripe-twin.arga.run/admin");
      expect(stripe.envVars).toEqual({
        STRIPE_API_KEY: "sk_test_twin_123",
        STRIPE_WEBHOOK_SECRET: "whsec_twin_456",
      });
      expect(stripe.showInUi).toBe(true);

      const github = result.twins.github;
      expect(github.baseUrl).toBe("https://github-twin.arga.run");
      expect(github.envVars).toEqual({ GITHUB_TOKEN: "ght_twin_789" });
    });
  });

  // ---- extend -------------------------------------------------------------

  describe("extend", () => {
    it("sends POST to /validate/twins/provision/{runId}/extend", async () => {
      const apiResponse = {
        status: "extended",
        ttl_minutes: 120,
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.twins.extend("run_twin_001", {
        ttlMinutes: 120,
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe(
        "https://api.test.com/validate/twins/provision/run_twin_001/extend",
      );
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.ttl_minutes).toBe(120);
      expect(body.ttlMinutes).toBeUndefined();

      expect(result.status).toBe("extended");
      expect(result.ttlMinutes).toBe(120);
    });
  });

  // ---- teardown ------------------------------------------------------------

  describe("teardown", () => {
    it("sends POST to /validate/twins/provision/{runId}/teardown", async () => {
      const apiResponse = { status: "teardown_initiated", run_id: "run_twin_001" };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.twins.teardown("run_twin_001");

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe(
        "https://api.test.com/validate/twins/provision/run_twin_001/teardown",
      );
      expect(opts.method).toBe("POST");
      expect(result.status).toBe("teardown_initiated");
    });
  });
});
