import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("RunsResource", () => {
  // ---- createUrlRun -------------------------------------------------------

  describe("createUrlRun", () => {
    it("sends a POST to /validate/url-run with snake_case body and returns camelCase", async () => {
      const apiResponse = {
        run_id: "run_abc123",
        status: "pending",
        session_id: "sess_xyz",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.createUrlRun({
        url: "https://staging.example.com",
        runnerMode: "fast",
        sessionId: "sess_xyz",
      });

      // Verify request
      expect(fetch).toHaveBeenCalledOnce();
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/url-run");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer arga_test_key");
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body.url).toBe("https://staging.example.com");
      expect(body.runner_mode).toBe("fast");
      expect(body.session_id).toBe("sess_xyz");
      // Verify camelCase keys are NOT in the request body
      expect(body.runnerMode).toBeUndefined();
      expect(body.sessionId).toBeUndefined();

      // Verify response is converted to camelCase
      expect(result.runId).toBe("run_abc123");
      expect(result.status).toBe("pending");
      expect(result.sessionId).toBe("sess_xyz");
    });
  });

  // ---- createUrlRun with diff-aware params ---------------------------------

  describe("createUrlRun with diff-aware params", () => {
    it("sends repo, branch, prUrl, provisionId as snake_case in the body", async () => {
      const apiResponse = {
        run_id: "run_diff_001",
        status: "pending",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      await client.runs.createUrlRun({
        url: "https://staging.example.com",
        repo: "owner/repo",
        branch: "feat-x",
        prUrl: "https://github.com/owner/repo/pull/42",
        provisionId: "run_provision_001",
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/url-run");
      const body = JSON.parse(opts.body);
      expect(body.repo).toBe("owner/repo");
      expect(body.branch).toBe("feat-x");
      expect(body.pr_url).toBe("https://github.com/owner/repo/pull/42");
      expect(body.provision_id).toBe("run_provision_001");
      // camelCase should not be in the request body
      expect(body.prUrl).toBeUndefined();
      expect(body.provisionId).toBeUndefined();
    });

    it("omits diff-aware fields when not provided", async () => {
      const fetch = mockFetch({ run_id: "run_abc", status: "pending" });
      const client = createClient(fetch);

      await client.runs.createUrlRun({ url: "https://staging.example.com" });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.repo).toBeUndefined();
      expect(body.branch).toBeUndefined();
      expect(body.pr_url).toBeUndefined();
      expect(body.provision_id).toBeUndefined();
    });
  });

  // ---- createPrRun --------------------------------------------------------

  describe("createPrRun", () => {
    it("sends a POST to /validate/pr-run with correct body", async () => {
      const apiResponse = {
        run_id: "run_pr_456",
        status: "queued",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.createPrRun({
        repo: "org/repo",
        branch: "feature-branch",
        contextNotes: "Testing the login flow",
        scenarioPrompt: "Test user registration",
        frontendUrl: "https://preview.example.com",
        sessionId: "sess_001",
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/pr-run");
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.repo).toBe("org/repo");
      expect(body.branch).toBe("feature-branch");
      expect(body.context_notes).toBe("Testing the login flow");
      expect(body.scenario_prompt).toBe("Test user registration");
      expect(body.frontend_url).toBe("https://preview.example.com");
      expect(body.session_id).toBe("sess_001");
      // camelCase should not be present
      expect(body.contextNotes).toBeUndefined();
      expect(body.scenarioPrompt).toBeUndefined();
      expect(body.frontendUrl).toBeUndefined();

      expect(result.runId).toBe("run_pr_456");
      expect(result.status).toBe("queued");
    });
  });

  // ---- createAgentRun -----------------------------------------------------

  describe("createAgentRun", () => {
    it("sends a POST to /validate/agent-run with correct body", async () => {
      const apiResponse = {
        run_id: "run_agent_789",
        status: "pending",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.createAgentRun({
        url: "https://app.example.com",
        focus: "authentication",
        actionBudget: 50,
        runnerMode: "thorough",
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/agent-run");

      const body = JSON.parse(opts.body);
      expect(body.url).toBe("https://app.example.com");
      expect(body.focus).toBe("authentication");
      expect(body.action_budget).toBe(50);
      expect(body.runner_mode).toBe("thorough");
      expect(body.actionBudget).toBeUndefined();
      expect(body.runnerMode).toBeUndefined();

      expect(result.runId).toBe("run_agent_789");
      expect(result.status).toBe("pending");
    });
  });

  // ---- get ----------------------------------------------------------------

  describe("get", () => {
    it("sends GET to /runs/{runId} and parses full RunDetail with camelCase", async () => {
      const apiResponse = {
        id: "run_detail_001",
        status: "completed",
        run_type: "url_run",
        mode: "standard",
        environment_url: "https://env.example.com",
        surface_urls: ["https://surface1.com", "https://surface2.com"],
        twins: ["stripe", "github"],
        results_json: { passed: 10, failed: 2 },
        event_log_json: [{ event_type: "click", target_id: "btn" }],
        story_json: { summary: "All tests passed" },
        attack_plan_json: null,
        redteam_report_json: null,
        step_summaries: [
          { step: "plan", status: "completed", detail: "Generated 5 tests" },
          { step: "execute", status: "completed" },
        ],
        failure_category: null,
        failure_detail: null,
        created_at: "2026-01-15T10:00:00Z",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.get("run_detail_001");

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/runs/run_detail_001");
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe("Bearer arga_test_key");

      // Verify camelCase conversion on all fields
      expect(result.id).toBe("run_detail_001");
      expect(result.status).toBe("completed");
      expect(result.runType).toBe("url_run");
      expect(result.mode).toBe("standard");
      expect(result.environmentUrl).toBe("https://env.example.com");
      expect(result.surfaceUrls).toEqual(["https://surface1.com", "https://surface2.com"]);
      expect(result.twins).toEqual(["stripe", "github"]);
      expect(result.resultsJson).toEqual({ passed: 10, failed: 2 });
      expect(result.storyJson).toEqual({ summary: "All tests passed" });
      expect(result.createdAt).toBe("2026-01-15T10:00:00Z");

      // Verify nested objects are also converted
      expect(result.stepSummaries).toHaveLength(2);
      expect(result.stepSummaries![0].step).toBe("plan");
      expect(result.stepSummaries![0].status).toBe("completed");
      expect(result.stepSummaries![0].detail).toBe("Generated 5 tests");

      // Verify nested camelCase conversion in eventLogJson
      const eventLog = result.eventLogJson as Array<Record<string, unknown>>;
      expect(eventLog[0].eventType).toBe("click");
      expect(eventLog[0].targetId).toBe("btn");
    });
  });

  // ---- cancel -------------------------------------------------------------

  describe("cancel", () => {
    it("sends POST to /validate/{runId}/cancel", async () => {
      const apiResponse = { status: "cancelled" };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.cancel("run_to_cancel");

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("https://api.test.com/validate/run_to_cancel/cancel");
      expect(opts.method).toBe("POST");

      expect(result.status).toBe("cancelled");
    });
  });

  // ---- wait ---------------------------------------------------------------

  describe("wait", () => {
    it("polls until the run reaches a terminal status", async () => {
      const runningResponse = {
        id: "run_wait_001",
        status: "running",
        run_type: "url_run",
      };
      const completedResponse = {
        id: "run_wait_001",
        status: "completed",
        run_type: "url_run",
        results_json: { passed: 5 },
      };

      let callCount = 0;
      const fetch = vi.fn().mockImplementation(() => {
        callCount++;
        const data = callCount <= 2 ? runningResponse : completedResponse;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
          text: () => Promise.resolve(JSON.stringify(data)),
        } as unknown as Response);
      });

      const client = createClient(fetch);

      const result = await client.runs.wait("run_wait_001", {
        pollInterval: 10, // short interval for tests
        timeout: 5000,
      });

      expect(result.id).toBe("run_wait_001");
      expect(result.status).toBe("completed");
      expect(result.resultsJson).toEqual({ passed: 5 });
      // Should have polled at least 3 times (2 running + 1 completed)
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("resolves immediately if the run is already completed", async () => {
      const apiResponse = {
        id: "run_done",
        status: "completed",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.wait("run_done", { pollInterval: 10 });

      expect(result.status).toBe("completed");
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("resolves when status is 'failed'", async () => {
      const apiResponse = {
        id: "run_fail",
        status: "failed",
        failure_category: "timeout",
        failure_detail: "Browser timed out",
      };
      const fetch = mockFetch(apiResponse);
      const client = createClient(fetch);

      const result = await client.runs.wait("run_fail", { pollInterval: 10 });

      expect(result.status).toBe("failed");
      expect(result.failureCategory).toBe("timeout");
      expect(result.failureDetail).toBe("Browser timed out");
    });
  });
});
