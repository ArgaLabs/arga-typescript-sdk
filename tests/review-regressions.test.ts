import { describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Tracing,
  validateEpisode,
  CapturePolicy,
} from "../src/tracing/index.js";

it("normalizes backend wire defaults before returning a complete Episode", () => {
  const episode = validateEpisode({
    source: "test",
    episode_id: "a".repeat(32),
    policy_hash: "b".repeat(64),
    events: [
      {
        sequence: 1,
        provider: "stripe",
        resource: "customers",
        verb: "retrieve",
        scope: "resource",
      },
    ],
  });
  expect(episode).toMatchObject({
    schema_version: "arga.evidence.v1",
    origin: "sdk",
    policies: [],
    issues: [],
    events: [{ parameters: {}, records: [] }],
  });
});
it("keeps namespace and method identity stable", () => {
  const t = new Tracing({ source: "test", upload: false }),
    original = { customers: { retrieve: async () => ({ id: "cus_test" }) } },
    wrapped = t.wrapStripe(original);
  expect(wrapped.customers).toBe(wrapped.customers);
  expect(wrapped.customers.retrieve).toBe(wrapped.customers.retrieve);
});
it("preserves Node unhandled rejection behavior for an ignored provider call", () => {
  const source = new URL("../src/tracing/index.ts", import.meta.url).href;
  const code = `import {Tracing} from ${JSON.stringify(source)}; const error=new Error('provider failure'); process.on('unhandledRejection',actual=>{console.log(actual===error?'same-error':'wrong-error');}); const t=new Tracing({source:'test',upload:false}); const client=t.wrapStripe({charges:{retrieve:()=>Promise.reject(error)}}); t.episode({},()=>{void client.charges.retrieve();});setTimeout(()=>{},30);`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    { encoding: "utf8", timeout: 5000 },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("same-error");
});
describe("CLI validation and retry behavior", () => {
  it.each([{ revision: ["1"] }, { goal_pointer: false }, { goal_pointer: 0 }])(
    "rejects malformed policy scalars %j",
    async (invalid) => {
      const dir = await mkdtemp(join(tmpdir(), "arga-cli-test-"));
      try {
        const policy = join(dir, "policy.json");
        await writeFile(policy, JSON.stringify(invalid));
        const run = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "src/tracing/cli.ts",
            "--project",
            "12345678-1234-4234-8234-123456789012",
            "--source",
            "test",
            "--state",
            join(dir, "state"),
            "--since",
            new Date().toISOString(),
            "--policy",
            policy,
          ],
          { encoding: "utf8", timeout: 5000 },
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("Invalid local policy JSON");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it("watch mode retries transient reads without printing source bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arga-cli-watch-"));
    try {
      const hook = join(dir, "mock.mjs"),
        policy = join(dir, "policy.json");
      await writeFile(policy, "{}");
      await writeFile(
        hook,
        `let calls=0;globalThis.fetch=async()=>++calls===1?new Response('PRIVATE_BODY_CANARY',{status:503}):Response.json({data:[]});`,
      );
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          hook,
          "src/tracing/cli.ts",
          "--project",
          "12345678-1234-4234-8234-123456789012",
          "--source",
          "test",
          "--state",
          join(dir, "state"),
          "--since",
          new Date(Date.now() - 60000).toISOString(),
          "--policy",
          policy,
          "--watch",
          "--poll-interval",
          "1",
        ],
        {
          env: {
            ...process.env,
            BRAINTRUST_API_KEY: "BT_SECRET",
            ARGA_TRACE_KEY: "ARGA_SECRET",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        errors = "";
      child.stdout.on("data", (data) => {
        output += data;
        if (output.includes('"uploaded"')) child.kill("SIGTERM");
      });
      child.stderr.on("data", (data) => {
        errors += data;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("CLI retry timed out"));
        }, 6000);
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        child.on("error", reject);
      });
      expect(code).toBe(0);
      expect(output).toContain('"uploaded":0');
      expect(errors).toContain("Braintrust read failed");
      expect(output + errors).not.toMatch(
        /PRIVATE_BODY_CANARY|BT_SECRET|ARGA_SECRET/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10000);
});
it("rejects a non-string policy revision in the programmatic API", () => {
  expect(
    () => new CapturePolicy({ revision: ["1"] as unknown as string }),
  ).toThrow();
});

it.each([
  '{"password":"CREDENTIAL_CANARY"}',
  "'api_key': 'CREDENTIAL_CANARY with spaces'",
  '{"access_token": "CREDENTIAL_CANARY"}',
  "arga_trace_CREDENTIAL_CANARY",
])("masks credentials in selected text: %s", (input) => {
  const t = new Tracing({
    source: "test",
    upload: false,
    policy: new CapturePolicy({ textFields: ["goal"] }),
  });
  t.episode({ goal: input }, () => {});
  expect(JSON.stringify(t.lastEpisode)).not.toContain("CREDENTIAL_CANARY");
});
it("preserves the provider call when instrumentation startup throws", async () => {
  const t = new Tracing({ source: "test", upload: false }),
    result = { id: "cus_test" },
    retrieve = vi.fn(async () => result),
    wrapped = t.wrapStripe({ customers: { retrieve } });
  vi.spyOn(t, "start").mockImplementation(() => {
    throw new Error("observer bug");
  });
  expect(await t.episode({}, () => wrapped.customers.retrieve())).toBe(result);
  expect(retrieve).toHaveBeenCalledOnce();
  expect(t.lastEpisode?.issues).toContain("projection_failed");
});
