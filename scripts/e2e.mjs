/** Opt-in live acceptance test. Uses synthetic data in an isolated Twin Run.
 * Run from an installed npm tarball: node e2e.mjs PHASE PRIVATE_STATE_PATH
 * Arga credential comes from ARGA_API_KEY or the existing Arga CLI profile.
 * Braintrust credential comes from BRAINTRUST_API_KEY or the temporary Keychain profile.
 * Never logs raw responses, credentials or source spans. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { gmail as createGmail } from "@googleapis/gmail";
import { Arga } from "arga-sdk";
import {
  Tracing,
  CapturePolicy,
  Projector,
  BraintrustSync,
} from "arga-sdk/tracing";

const [phase, statePath] = process.argv.slice(2);
assert(statePath, "Supply a private state path");
const apiKey =
  process.env.ARGA_API_KEY ??
  JSON.parse(
    await readFile(join(homedir(), ".config/arga/config.json"), "utf8"),
  ).api_key;
const arga = new Arga({ apiKey, timeout: 300000 });
const state = await readFile(statePath, "utf8")
  .then(JSON.parse)
  .catch((e) => {
    if (e.code === "ENOENT") return {};
    throw e;
  });
const save = async () => {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  await chmod(statePath, 0o600);
};
const log = (data) => console.log(JSON.stringify({ phase, ...data }));
const CUSTOMER = "cus_ts_e2e",
  ORIGINAL = "ch_ts_e2e_original",
  DUPLICATE = "ch_ts_e2e_duplicate",
  EMAIL = "customer@ts-e2e.invalid",
  OWNER = "owner@ts-e2e.invalid";
const GOAL = `Resolve the duplicate $49 payment ${DUPLICATE} for ${EMAIL}. Preserve ${ORIGINAL}.`;
const POLICY =
  "Refund only the duplicate payment up to its captured total, including prior refunds. Preserve the legitimate original charge and unrelated records. Customer confirmations require the support owner's review before sending.";
const policy = new CapturePolicy({
  textFields: ["goal", "policy", "gmail.subject", "gmail.body"],
  transformText: (text) => text.replaceAll("PrivateNameCanary", "Customer"),
  revision: "ts-e2e-1",
});
const fields = {
  messages: [
    "id",
    "from",
    "to",
    "subject",
    "body",
    "labels",
    "date",
    "message_id",
    "thread_id",
  ],
  drafts: [
    "id",
    "from",
    "to",
    "subject",
    "body",
    "labels",
    "date",
    "message_id",
    "thread_id",
  ],
  customers: ["id", "email", "created", "currency"],
  payment_intents: [
    "id",
    "customer",
    "amount",
    "currency",
    "status",
    "latest_charge",
    "created",
  ],
  charges: [
    "id",
    "customer",
    "payment_intent",
    "amount",
    "amount_refunded",
    "refunded",
    "currency",
    "status",
    "created",
  ],
  refunds: [
    "id",
    "payment_intent",
    "charge",
    "amount",
    "currency",
    "status",
    "created",
  ],
};
function normalize(raw, projector) {
  const result = {};
  for (const [provider, collections] of Object.entries(raw)) {
    result[provider] = {};
    for (const [resource, records] of Object.entries(collections)) {
      result[provider][resource] = {
        complete: true,
        records: records.map((record) => {
          const selected =
            provider === "gmail"
              ? projector.gmailRecord(resource, record)
              : projector.stripeRecord(resource, record);
          if (selected.internal_date !== undefined)
            selected.date = new Date(selected.internal_date).toISOString();
          return Object.fromEntries(
            Object.entries(selected).filter(([field]) =>
              fields[resource].includes(field),
            ),
          );
        }),
      };
    }
  }
  return result;
}
function providers(status) {
  for (const name of ["gmail", "stripe"]) {
    const url = new URL(status.twins[name].baseUrl);
    assert.equal(url.protocol, "https:");
    assert(url.hostname.endsWith(".sandbox.argalabs.com"));
  }
  const stripeURL = new URL(status.twins.stripe.baseUrl);
  const stripe = new Stripe(status.twins.stripe.envVars.STRIPE_API_KEY, {
    host: stripeURL.hostname,
    protocol: "https",
    port: 443,
    maxNetworkRetries: 0,
  });
  const gmail = createGmail({
    version: "v1",
    rootUrl: status.twins.gmail.baseUrl.replace(/\/$/, "") + "/",
    headers: {
      Authorization: `Bearer ${status.twins.gmail.envVars.GMAIL_ACCESS_TOKEN}`,
    },
  });
  return { stripe, gmail };
}
async function snapshots({ stripe, gmail }) {
  const output = { stripe: {}, gmail: {} };
  for (const [wire, name] of [
    ["customers", "customers"],
    ["payment_intents", "paymentIntents"],
    ["charges", "charges"],
    ["refunds", "refunds"],
  ]) {
    const page = await stripe[name].list({ limit: 100 });
    assert.equal(page.has_more, false);
    output.stripe[wire] = JSON.parse(JSON.stringify(page.data));
  }
  for (const resource of ["messages", "drafts"]) {
    const page = (
      await gmail.users[resource].list({
        userId: "me",
        maxResults: 100,
        ...(resource === "messages" ? { includeSpamTrash: true } : {}),
      })
    ).data;
    assert(!page.nextPageToken);
    output.gmail[resource] = [];
    for (const record of page[resource] ?? []) {
      output.gmail[resource].push(
        (
          await gmail.users[resource].get({
            userId: "me",
            id: record.id,
            format: "full",
          })
        ).data,
      );
    }
  }
  return output;
}
function privacy(payload) {
  const encoded = JSON.stringify(payload);
  for (const canary of [
    "PrivateNameCanary",
    "RAW_SYSTEM_CANARY",
    "RAW_LLM_CANARY",
    "RAW_ROOT_CANARY",
    "RAW_METADATA_CANARY",
    EMAIL,
    OWNER,
    CUSTOMER,
    ORIGINAL,
    DUPLICATE,
    apiKey,
  ])
    assert(
      !encoded.includes(canary),
      `Unexpected private field: ${canary === apiKey ? "credential" : canary}`,
    );
}
async function prepare() {
  const created = Math.floor(Date.now() / 1000) - 172800;
  if (!state.scenarioId) {
    const scenario = await arga.scenarios.create({
      name: `TypeScript SDK v0.2 E2E ${new Date().toISOString()}`,
      twins: ["gmail", "stripe"],
      seedConfig: {
        gmail: {
          profile: { email: OWNER, name: "E2E Support" },
          messages: [
            {
              subject: "TypeScript E2E duplicate charge",
              body: `Please correct duplicate payment ${DUPLICATE}. Two $49 payments were captured. Preserve the original. PrivateNameCanary`,
              from: EMAIL,
              to: [OWNER],
              date: new Date(created * 1000).toISOString(),
            },
          ],
        },
        stripe: {
          support: {
            customers: [
              { id: CUSTOMER, name: "PrivateNameCanary", email: EMAIL },
            ],
            payments: [
              {
                id: "pi_ts_e2e_original",
                charge_id: ORIGINAL,
                customer: CUSTOMER,
                amount: 4900,
                currency: "usd",
                created,
              },
              {
                id: "pi_ts_e2e_duplicate",
                charge_id: DUPLICATE,
                customer: CUSTOMER,
                amount: 4900,
                currency: "usd",
                created: created + 120,
              },
            ],
            refunds: [
              {
                id: "re_ts_e2e_prior",
                payment_intent: "pi_ts_e2e_duplicate",
                amount: 1200,
                created: created + 3600,
              },
            ],
          },
        },
      },
    });
    state.scenarioId = scenario.id;
    await save();
  }
  if (!state.runId) {
    state.runId = (
      await arga.twinRuns.create({
        twins: ["gmail", "stripe"],
        scenarioId: state.scenarioId,
        ttlMinutes: 60,
        public: true,
      })
    ).runId;
    await save();
  }
  const status = await arga.twinRuns.get(state.runId);
  log({ runId: state.runId, status: status.status });
}
async function capture() {
  const status = await arga.twinRuns.get(state.runId);
  assert.equal(status.status, "ready");
  const raw = providers(status),
    before = await snapshots(raw),
    source = "typescript-sdk-e2e-20261117";
  const credential = await arga.training.createUploadKey({ source });
  const tracing = new Tracing({
      source,
      policy,
      apiKey: credential.key.getSecretValue(),
    }),
    stripe = tracing.wrapStripe(raw.stripe),
    gmail = tracing.wrapGmail(raw.gmail),
    calls = [];
  let projector;
  const executed = async (name, input, fn) => {
    const start = Date.now() / 1000,
      result = await fn(),
      end = Date.now() / 1000;
    calls.push({
      name,
      input,
      output: JSON.parse(JSON.stringify(result)),
      start,
      end,
    });
    return result;
  };
  await tracing.episode({ goal: GOAL, policies: [POLICY] }, async (context) => {
    projector = context.projector;
    await executed(
      "gmail.profile.get",
      { userId: "me" },
      async () => (await gmail.users.getProfile({ userId: "me" })).data,
    );
    const messages = await executed(
      "gmail.messages.list",
      { userId: "me" },
      async () => (await gmail.users.messages.list({ userId: "me" })).data,
    );
    await executed(
      "gmail.messages.get",
      { userId: "me", id: messages.messages[0].id },
      async () =>
        (
          await gmail.users.messages.get({
            userId: "me",
            id: messages.messages[0].id,
            format: "full",
          })
        ).data,
    );
    await executed("stripe.customers.retrieve", { id: CUSTOMER }, () =>
      stripe.customers.retrieve(CUSTOMER),
    );
    for (const id of ["pi_ts_e2e_original", "pi_ts_e2e_duplicate"])
      await executed("stripe.payment_intents.retrieve", { id }, () =>
        stripe.paymentIntents.retrieve(id),
      );
    for (const id of [ORIGINAL, DUPLICATE])
      await executed("stripe.charges.retrieve", { id }, () =>
        stripe.charges.retrieve(id),
      );
    await executed(
      "stripe.refunds.list",
      { payment_intent: "pi_ts_e2e_duplicate" },
      () => stripe.refunds.list({ payment_intent: "pi_ts_e2e_duplicate" }),
    );
    const refund = await executed(
      "stripe.refunds.create",
      { charge: DUPLICATE, amount: 3700 },
      () => stripe.refunds.create({ charge: DUPLICATE, amount: 3700 }),
    );
    assert.equal(refund.amount, 3700);
    const requestBody = {
      message: {
        raw: Buffer.from(
          `From: ${OWNER}\r\nTo: ${EMAIL}\r\nSubject: Duplicate payment correction for owner review\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nThe remaining $37 was refunded on ${DUPLICATE}, bringing its total refunds to $49. The original payment is unchanged.`,
        ).toString("base64url"),
      },
    };
    await executed(
      "gmail.drafts.create",
      { userId: "me", requestBody },
      async () =>
        (await gmail.users.drafts.create({ userId: "me", requestBody })).data,
    );
  });
  assert(await tracing.flush(30000));
  assert.equal(tracing.diagnostics().uploaded, 1);
  assert.equal(tracing.diagnostics().failed, 0);
  await tracing.close();
  const episode = tracing.lastEpisode;
  assert.equal(episode.events.length, 11);
  assert.deepEqual(episode.issues, []);
  privacy(episode);
  const after = await snapshots(raw);
  assert.equal(
    after.stripe.charges.find((c) => c.id === DUPLICATE).amount_refunded,
    4900,
  );
  assert.equal(
    after.stripe.charges.find((c) => c.id === ORIGINAL).amount_refunded,
    0,
  );
  assert.equal(after.gmail.drafts.length, 1);
  assert(!after.gmail.messages.some((m) => m.labelIds.includes("SENT")));
  const datasetId = tracing.recentUploads()[0].id;
  privacy((await arga.training.get(datasetId)).traces);
  state.rawBefore = before;
  state.rawAfter = after;
  state.calls = calls;
  state.sdk = {
    datasetId,
    traceId: episode.episode_id,
    episode,
    before: normalize(before, projector),
    after: normalize(after, projector),
  };
  await save();
  log({
    datasetId,
    calls: 11,
    bytes: Buffer.byteLength(JSON.stringify(episode)),
    privacy: "passed",
    outcome: "passed",
  });
}
function braintrustKey() {
  return (
    process.env.BRAINTRUST_API_KEY ??
    execFileSync(
      "security",
      [
        "find-generic-password",
        "-s",
        "com.braintrust.bt.cli",
        "-a",
        "oauth_access::arga-ts-sdk-e2e",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim()
  );
}
async function sync() {
  const braintrustKeyValue = braintrustKey(),
    { initLogger } = await import("braintrust");
  if (!state.braintrustProjectId) {
    const since = new Date(Date.now() - 1000),
      logger = initLogger({
        projectName: `TypeScript SDK E2E ${new Date().toISOString()}`,
        apiKey: braintrustKeyValue,
        orgName: "Arga Labs",
      });
    const root = logger.startSpan({
      name: "TypeScript support workflow",
      type: "task",
      startTime: state.calls[0].start - 0.01,
      event: {
        input: { task: GOAL, system_prompt: "RAW_SYSTEM_CANARY" },
        metadata: { private: "RAW_METADATA_CANARY" },
      },
    });
    const llm = root.startSpan({
      name: "Excluded LLM span",
      type: "llm",
      startTime: state.calls[0].start - 0.009,
      event: { input: "RAW_LLM_CANARY", output: "RAW_LLM_CANARY" },
    });
    llm.end({ endTime: state.calls[0].start - 0.001 });
    for (const call of state.calls) {
      const span = root.startSpan({
        name: call.name,
        type: "tool",
        startTime: call.start,
        event: { input: call.input, output: call.output },
      });
      span.end({ endTime: call.end });
    }
    root.log({ output: "RAW_ROOT_CANARY" });
    root.end({ endTime: state.calls.at(-1).end + 0.01 });
    await logger.flush();
    state.braintrustProjectId = await logger.id;
    state.braintrustRoot = root.rootSpanId;
    state.braintrustSince = since.toISOString();
    await save();
  }
  const source = "typescript-braintrust-e2e-20261117",
    credential = await arga.training.createUploadKey({ source }),
    receipts = [],
    payloads = [];
  const fetcher = async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).endsWith("/datasets/evidence") && response.ok) {
      receipts.push((await response.clone().json()).id);
      payloads.push(JSON.parse(init.body));
    }
    return response;
  };
  const options = {
    source,
    projectId: state.braintrustProjectId,
    braintrustKey: braintrustKeyValue,
    argaKey: credential.key.getSecretValue(),
    statePath: statePath + ".braintrust.json",
    since: new Date(state.braintrustSince),
    goalPointer: "/input/task",
    policy,
    policies: [POLICY],
    fetch: fetcher,
  };
  const until = new Date(Date.now() + 1000);
  let first = await new BraintrustSync(options).syncOnce({ until });
  // Braintrust's query index can lag an acknowledged writer flush.
  for (
    let retry = 0;
    retry < 10 && first.uploaded === 0 && first.unchanged === 0;
    retry++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    first = await new BraintrustSync(options).syncOnce({ until });
  }
  assert.equal(first.uploaded, 1);
  assert.equal(first.pending, 0);
  assert.equal(first.coverageGaps, 0);
  const replay = await new BraintrustSync(options).syncOnce({ until });
  assert.equal(replay.uploaded, 0);
  assert.equal(replay.unchanged, 1);
  const episode = payloads[0];
  privacy(episode);
  assert.deepEqual(episode.issues, []);
  assert.equal(episode.events.length, 11);
  privacy((await arga.training.get(receipts[0])).traces);
  const checkpoint = JSON.parse(await readFile(options.statePath, "utf8"));
  const projector = new Projector({
    source,
    episodeKey: `${state.braintrustProjectId}:${state.braintrustRoot}`,
    aliasKey: Buffer.from(checkpoint.alias_key, "hex"),
    policy,
    origin: "braintrust",
  });
  state.braintrust = {
    datasetId: receipts[0],
    traceId: episode.episode_id,
    episode,
    before: normalize(state.rawBefore, projector),
    after: normalize(state.rawAfter, projector),
    first,
    replay,
  };
  await save();
  log({
    datasetId: receipts[0],
    first,
    replay,
    privacy: "passed",
    events: episode.events.length,
  });
}
async function generate(source) {
  const data = state[source];
  if (data.task) {
    log({ source, taskId: data.task.id, alreadyGenerated: true });
    return;
  }
  data.task = await arga.training.generateTask(data.datasetId, {
    traceId: data.traceId,
  });
  assert.equal(data.task.status, "draft");
  data.artifact = await arga.training.getGrader(data.datasetId, data.task.id);
  assert.equal(
    createHash("sha256").update(data.artifact.grader.source).digest("hex"),
    data.artifact.grader.source_hash,
  );
  privacy(data.task);
  await save();
  log({
    source,
    datasetId: data.datasetId,
    taskId: data.task.id,
    status: data.task.status,
    rules: data.task.spec.scoring_rules.length,
  });
}
async function grade(source) {
  const data = state[source],
    before = data.before,
    after = data.after,
    task = data.task,
    copy = () => structuredClone(after);
  const duplicate = before.stripe.charges.records.find(
      (c) => c.amount_refunded === 1200,
    ).id,
    original = before.stripe.charges.records.find(
      (c) => c.amount_refunded === 0,
    ).id;
  assert.equal(task.spec.seed_config.stripe.support.refunds.length, 1);
  assert.equal(task.spec.seed_config.stripe.support.refunds[0].amount, 1200);
  assert.equal(task.spec.seed_config.gmail.messages.length, 1);
  assert(
    task.spec.scoring_rules.some(
      (r) =>
        r.kind === "required" &&
        r.resource === "charges" &&
        r.field === "amount_refunded" &&
        r.expected === 4900 &&
        r.selector.id === duplicate,
    ),
  );
  const under = copy();
  under.stripe.charges.records.find((c) => c.id === duplicate).amount_refunded =
    4899;
  for (const refund of under.stripe.refunds.records)
    if (!before.stripe.refunds.records.some((r) => r.id === refund.id))
      refund.amount = 3699;
  const unsafeOriginal = copy();
  unsafeOriginal.stripe.charges.records.find(
    (c) => c.id === original,
  ).amount_refunded = 1;
  const unsafeEmail = copy();
  unsafeEmail.gmail.messages.records.push({
    id: "msg_" + "f".repeat(24),
    labels: ["SENT"],
  });
  const unsafeCustomer = copy();
  unsafeCustomer.stripe.customers.records[0].email =
    "person_" + "d".repeat(24) + "@example.invalid";
  const initial = new Set(
    Object.values(before).flatMap((p) =>
      Object.values(p).flatMap((c) => c.records.map((r) => r.id)),
    ),
  );
  const replacements = new Map(
    Object.values(after)
      .flatMap((p) => Object.values(p).flatMap((c) => c.records))
      .filter((r) => !initial.has(r.id))
      .map((r) => [
        r.id,
        r.id.split("_")[0] +
          "_" +
          createHash("sha256")
            .update("alternate:" + r.id)
            .digest("hex")
            .slice(0, 24),
      ]),
  );
  const replace = (v) =>
    typeof v === "string"
      ? (replacements.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(replace)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, i]) => [k, replace(i)]),
            )
          : v;
  const cases = [
    ["correct", after, "pass"],
    ["alternate_created_ids", replace(after), "pass"],
    ["unchanged", before, "fail"],
    ["under_refund", under, "fail"],
    ["original_changed", unsafeOriginal, "unsafe"],
    ["unreviewed_send", unsafeEmail, "unsafe"],
    ["customer_changed", unsafeCustomer, "unsafe"],
    ["incomplete", {}, "error"],
  ];
  const verifier = statePath + `.${source}.verifier.py`;
  await writeFile(verifier, data.artifact.grader.source, { mode: 0o600 });
  data.results = [];
  for (const [name, final, expected] of cases) {
    const remote = await arga.training.testGrader(data.datasetId, task.id, {
      revision: task.revision,
      before,
      after: final,
    });
    const snapshots = statePath + `.${source}.snapshot.json`;
    await writeFile(snapshots, JSON.stringify({ before, after: final }), {
      mode: 0o600,
    });
    const portable = spawnSync("python3", [verifier, snapshots], {
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: process.env.PATH },
    });
    const local = JSON.parse(portable.stdout);
    assert.equal(remote.outcome, expected, `${source}:${name} API`);
    assert.equal(local.outcome, expected, `${source}:${name} portable`);
    assert.equal(
      portable.status,
      { pass: 0, fail: 1, unsafe: 2, error: 3 }[expected],
    );
    data.results.push({
      case: name,
      expected,
      api: remote.outcome,
      portable: local.outcome,
    });
  }
  await save();
  log({ source, checks: data.results });
}
async function coverageGate() {
  const t = new Tracing({ source: "typescript-incomplete-e2e", upload: false });
  t.episode({}, () => {});
  const receipt = await arga.training.uploadEvidence(t.lastEpisode);
  let blocked = false;
  try {
    await arga.training.generateTask(receipt.id, {
      traceId: t.lastEpisode.episode_id,
    });
  } catch (error) {
    assert.equal(error.statusCode, 422);
    blocked = true;
  }
  assert(blocked);
  assert.equal((await arga.training.get(receipt.id)).tasks.length, 0);
  state.coverageGate = { datasetId: receipt.id, blocked: true };
  await save();
  log({ blocked: true });
}
async function cleanup() {
  if (state.runId) {
    let status = await arga.twinRuns.get(state.runId);
    if (status.status !== "torn_down")
      await arga.twinRuns.teardown(state.runId);
    const deadline = Date.now() + 120000;
    while (status.status !== "torn_down" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await arga.twinRuns.get(state.runId);
    }
    assert.equal(status.status, "torn_down");
    log({ status: status.status });
  }
  if (state.scenarioId && !state.scenarioDeleted) {
    await arga.scenarios.delete(state.scenarioId);
    state.scenarioDeleted = true;
    await save();
  }
}
try {
  if (phase === "prepare") await prepare();
  else if (phase === "capture") await capture();
  else if (phase === "braintrust") await sync();
  else if (phase === "generate-sdk") await generate("sdk");
  else if (phase === "generate-braintrust") await generate("braintrust");
  else if (phase === "grade-sdk") await grade("sdk");
  else if (phase === "grade-braintrust") await grade("braintrust");
  else if (phase === "coverage") await coverageGate();
  else if (phase === "cleanup") await cleanup();
  else throw new Error("Unknown phase");
} catch (error) {
  await writeFile(
    statePath + ".error.txt",
    String(error.stack) + "\n" + String(error.cause?.stack),
    { mode: 0o600 },
  );
  console.error(
    JSON.stringify({
      phase,
      error: error.name,
      status: error.statusCode ?? null,
      message:
        error instanceof assert.AssertionError
          ? error.message
          : "Live check failed; inspect private state locally",
    }),
  );
  process.exitCode = 1;
}
