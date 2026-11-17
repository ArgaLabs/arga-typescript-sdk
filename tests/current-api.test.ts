import { describe, expect, it, vi } from "vitest";
import { Arga } from "../src/index.js";
import fixture from "./fixtures/support-evidence-v1.json" with { type: "json" };
import type { Episode } from "../src/tracing/models.js";

function setup(response: unknown = {}) {
  const fetch = vi.fn(async () => Response.json(response)),
    client = new Arga({ apiKey: "TEST_KEY", fetch });
  return {
    client,
    fetch,
    request: () => ({
      url: fetch.mock.calls.at(-1)?.[0],
      options: fetch.mock.calls.at(-1)?.[1],
    }),
  };
}
describe("current backend contracts", () => {
  it("uses current Twin Run endpoints and preserves uppercase env vars and provider names", async () => {
    const { client, fetch } = setup({
      run_id: "id",
      status: "ready",
      twins: {
        google_calendar: {
          base_url: "https://provider",
          env_vars: { GOOGLE_API_KEY: "key" },
        },
      },
    });
    await client.twinRuns.create({
      twins: ["google_calendar"],
      ttlMinutes: 60,
      accessProfile: "candidate_api_only",
    });
    expect(String(fetch.mock.calls[0][0])).toBe(
      "https://api.argalabs.com/twin-runs",
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      twins: ["google_calendar"],
      ttl_minutes: 60,
      access_profile: "candidate_api_only",
    });
    const status = await client.twinRuns.wait("id");
    expect(status.twins.google_calendar.envVars).toEqual({
      GOOGLE_API_KEY: "key",
    });
    await client.twinRuns.reset("id");
    expect(String(fetch.mock.calls.at(-1)?.[0])).toContain(
      "/validate/twins/provision/id/reset",
    );
    await expect(
      client.twinRuns.wait("id", { pollInterval: 0 }),
    ).rejects.toThrow();
  });
  it("leaves TestConfig and clearable values unchanged", async () => {
    const config = {
      blocks: [
        { action_type: "fill", targetID: "A", parameters: { Some_Key: false } },
      ],
    };
    const { client, fetch } = setup({
      id: "id",
      status: "completed",
      test_config_json: config,
    });
    expect(
      (
        await client.testRuns.create({
          prompt: "Check",
          testConfig: config,
          startUrl: null,
        })
      ).testConfigJson,
    ).toEqual(config);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      prompt: "Check",
      test_config: config,
      start_url: null,
    });
    await client.testRuns.updateConfig("id", config);
    expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe("PATCH");
    await client.tests.update("id", {
      ciEnabled: false,
      tags: [],
      credentials: null,
    });
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({
      ci_enabled: false,
      tags: [],
      credentials: null,
    });
  });
  it("unwraps collection lists and uses current Scenario edit/delete/copy routes", async () => {
    const a = setup({ runs: [{ id: "r" }] });
    expect(await a.client.testRuns.list()).toEqual([{ id: "r" }]);
    const b = setup({ tests: [{ id: "t" }] });
    expect(await b.client.tests.list({ repoFullName: "org/repo" })).toEqual([
      { id: "t" },
    ]);
    expect(String(b.fetch.mock.calls[0][0])).toContain(
      "repo_full_name=org%2Frepo",
    );
    await b.client.scenarios.update("s", {
      seedConfig: { google_calendar: { calendarID: "Exact" } },
      description: null,
    });
    expect(b.fetch.mock.calls.at(-1)?.[1]?.method).toBe("PUT");
    expect(
      JSON.parse(String(b.fetch.mock.calls.at(-1)?.[1]?.body)).seed_config
        .google_calendar.calendarID,
    ).toBe("Exact");
    await b.client.scenarios.copy("s", { name: "Copy" });
    expect(String(b.fetch.mock.calls.at(-1)?.[0])).toContain(
      "/scenarios/s/copy",
    );
    await b.client.scenarios.delete("s");
    expect(b.fetch.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });
  it("preserves Training wire evidence, task specs and normalized snapshots", async () => {
    const { client, fetch } = setup({
      id: "dataset",
      traces: [{ id: "trace", payload: fixture }],
      tasks: [],
    });
    await client.training.uploadEvidence(fixture as Episode);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(fixture);
    const detail = await client.training.get("dataset");
    expect(detail.traces[0].payload).toEqual(fixture);
    const spec = {
      starting_state: {
        stripe: { payment_intents: [{ latest_charge: "ch_alias" }] },
      },
      scoring_rules: [{ rule_id: "r" }],
    };
    await client.training.updateTask("dataset", "task", { revision: 2, spec });
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({
      revision: 2,
      spec,
    });
    const snapshot = {
      stripe: {
        payment_intents: {
          complete: true,
          records: [{ id: "pi_alias", latest_charge: "ch_alias" }],
        },
      },
    };
    await client.training.testGrader("dataset", "task", {
      revision: 2,
      before: snapshot,
      after: snapshot,
    });
    expect(
      JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body)).before,
    ).toEqual(snapshot);
    await client.training.reviewTask("dataset", "task", {
      revision: 2,
      decision: "approved",
    });
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({
      revision: 2,
      decision: "approved",
      acknowledge_assumptions: false,
      acknowledge_grader: false,
    });
  });
  it("returns artifact redirects without forwarding Authorization to storage", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://storage.example/artifact?signature=abc",
          },
        }),
    );
    const client = new Arga({ apiKey: "TEST_KEY", fetch });
    expect(
      await client.testRuns.artifactUrl("id", "screens/one.png"),
    ).toContain("https://storage.example/");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
    expect(() => client.testRuns.artifactUrl("id", "../secret")).toThrow();
    expect(() => client.training.get("..")).toThrow();
  });
  it("keeps JSONL raw and upload secrets out of logs", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/export")
        ? new Response('{"source_id":"x"}\n')
        : Response.json({
            key: "NEVER_PRINT_KEY",
            source: "support",
            scope: "training:ingest",
            expires_at: "soon",
          }),
    );
    const client = new Arga({ apiKey: "KEY", fetch });
    const credential = await client.training.createUploadKey({
      source: "support",
    });
    expect(JSON.stringify(credential)).not.toContain("NEVER_PRINT_KEY");
    expect(credential.key.getSecretValue()).toBe("NEVER_PRINT_KEY");
    expect(await client.training.exportJsonl("dataset")).toBe(
      '{"source_id":"x"}\n',
    );
  });
});
