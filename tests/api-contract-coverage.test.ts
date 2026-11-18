import { expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { Arga, ArgaError } from "../src/index.js";

const cases: Array<[string, string, unknown[], string, string, unknown?]> = [
  [
    "twinRuns",
    "extend",
    ["run", { ttlMinutes: 45 }],
    "POST",
    "/twin-runs/run/extend",
    { ttl_minutes: 45 },
  ],
  ["twinRuns", "lock", ["run"], "POST", "/twin-runs/run/lock"],
  ["twinRuns", "teardown", ["run"], "POST", "/twin-runs/run/teardown"],
  [
    "twinRuns",
    "microsoftScenarioSnapshot",
    ["run"],
    "GET",
    "/twin-runs/run/microsoft-scenario-snapshot",
  ],
  [
    "scenarios",
    "list",
    [
      {
        includePresets: false,
        scope: "personal",
        search: "support",
        limit: 25,
        offset: 0,
      },
    ],
    "GET",
    "/scenarios?scope=personal&include_presets=false&limit=25&offset=0&search=support",
  ],
  [
    "scenarios",
    "listPresets",
    [{ twin: "stripe", tag: "support" }],
    "GET",
    "/scenarios/presets?twin=stripe&tag=support",
  ],
  ["scenarios", "getPreset", ["preset"], "GET", "/scenarios/presets/preset"],
  [
    "scenarios",
    "listLongRuns",
    [{ limit: 2, offset: 3 }],
    "GET",
    "/scenarios/long-runs?limit=2&offset=3",
  ],
  [
    "tests",
    "create",
    [
      {
        name: "Case",
        prompt: "Verify",
        startUrl: "https://example.com",
        testConfig: { case_id: "Exact" },
        ciEnabled: false,
      },
    ],
    "POST",
    "/tests",
    {
      name: "Case",
      prompt: "Verify",
      start_url: "https://example.com",
      test_config: { case_id: "Exact" },
      ci_enabled: false,
    },
  ],
  ["tests", "get", ["test"], "GET", "/tests/test"],
  ["tests", "delete", ["test"], "DELETE", "/tests/test"],
  [
    "tests",
    "run",
    [
      "test",
      {
        startUrl: "https://example.com",
        scenarioId: "scenario",
        twins: [],
        ttlMinutes: 30,
      },
    ],
    "POST",
    "/tests/test/run",
    {
      start_url: "https://example.com",
      scenario_id: "scenario",
      twins: [],
      ttl_minutes: 30,
    },
  ],
  [
    "training",
    "list",
    [{ limit: 2, offset: 3 }],
    "GET",
    "/datasets?limit=2&offset=3",
  ],
  [
    "training",
    "generateTask",
    ["dataset", { traceId: "trace" }],
    "POST",
    "/datasets/dataset/tasks",
    { variation: "", trace_id: "trace" },
  ],
  [
    "training",
    "prepareGrader",
    ["dataset", "task", { revision: 3 }],
    "POST",
    "/datasets/dataset/tasks/task/grader",
    { revision: 3 },
  ],
  [
    "training",
    "getGrader",
    ["dataset", "task"],
    "GET",
    "/datasets/dataset/tasks/task/grader",
  ],
  [
    "training",
    "createEnvironment",
    ["dataset", "task"],
    "POST",
    "/datasets/dataset/tasks/task/environment",
  ],
];
it.each(cases)(
  "matches the current %s.%s backend contract",
  async (resource, method, args, httpMethod, path, body) => {
    const fetch = vi.fn(async () => Response.json([])),
      client = new Arga({ apiKey: "test", fetch });
    await (client as any)[resource][method](...args);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.argalabs.com" + path);
    expect(init.method).toBe(httpMethod);
    expect(
      init.body === undefined ? undefined : JSON.parse(String(init.body)),
    ).toEqual(body);
  },
);
it("redacts upload keys in string and inspect logging paths", async () => {
  const client = new Arga({
    apiKey: "test",
    fetch: async () =>
      Response.json({
        key: "PRIVATE_CREDENTIAL",
        source: "test",
        scope: "training:ingest",
        expires_at: "soon",
      }),
  });
  const credential = await client.training.createUploadKey({ source: "test" });
  expect(String(credential.key) + inspect(credential)).not.toContain(
    "PRIVATE_CREDENTIAL",
  );
});
it("rejects empty filters and invalid millisecond timeout values", () => {
  for (const timeout of [2147483648, 0.5, NaN])
    expect(() => new Arga({ apiKey: "test", timeout })).toThrow(ArgaError);
});
it("preserves a relative artifact redirect against its request URL", async () => {
  const client = new Arga({
    apiKey: "test",
    fetch: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "downloads/image.png" },
      }),
  });
  expect(await client.testRuns.artifactUrl("run", "image.png")).toBe(
    "https://api.argalabs.com/test-runs/run/artifacts/downloads/image.png",
  );
});
it("wraps request timeouts while preserving unrelated network errors", async () => {
  const client = new Arga({
    apiKey: "test",
    timeout: 20,
    fetch: async () => {
      throw new DOMException("private upstream detail", "TimeoutError");
    },
  });
  await expect(client.training.get("dataset")).rejects.toThrow(
    "Arga request timed out after 20ms",
  );
  const network = new Error("network failure");
  const original = new Arga({
    apiKey: "test",
    fetch: async () => {
      throw network;
    },
  });
  await expect(original.training.get("dataset")).rejects.toBe(network);
});

it("rejects an explicitly empty repository filter", async () => {
  const client = new Arga({ apiKey: "test" });
  await expect(client.tests.list({ repoFullName: "" })).rejects.toThrow(
    "repoFullName must not be empty",
  );
});
it("rejects inconsistent operation scopes through the promise contract", async () => {
  const client = new Arga({ apiKey: "test" });
  await expect(
    client.training.uploadEvidence({
      schema_version: "arga.evidence.v1",
      source: "test",
      origin: "sdk",
      episode_id: "a".repeat(32),
      policy_hash: "b".repeat(64),
      policies: [],
      issues: [],
      events: [
        {
          sequence: 1,
          provider: "stripe",
          resource: "customers",
          verb: "list",
          scope: "mutation",
          parameters: {},
          records: [],
        },
      ],
    }),
  ).rejects.toThrow("Unsupported evidence operation or scope");
});
