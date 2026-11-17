import { describe, expect, it, vi } from "vitest";
import {
  Tracing,
  CapturePolicy,
  Projector,
  validateEpisode,
  blockers,
} from "../src/tracing/index.js";
import { inspect } from "node:util";
import { Secret } from "../src/training.js";
import fixture from "./fixtures/support-evidence-v1.json" with { type: "json" };

const policy = new CapturePolicy({
  textFields: ["goal", "policy", "gmail.subject", "gmail.body"],
  transformText: (text) => text.replaceAll("PRIVATE_NAME", "Customer"),
  revision: "test-1",
});
const key = Buffer.alloc(32, 7);
const customer = {
  id: "cus_private",
  email: "alice@private.test",
  name: "PRIVATE_NAME",
  metadata: { secret: "RAW_METADATA" },
};
const message = {
  id: "raw-message-id",
  threadId: "raw-thread",
  labelIds: ["INBOX", "PRIVATE_LABEL"],
  internalDate: "1700000000000",
  snippet: "RAW_SNIPPET",
  raw: "RAW_MIME",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "Subject", value: "PRIVATE_NAME refund ch_private" },
      { name: "From", value: '"PRIVATE_NAME" <alice@private.test>' },
      { name: "To", value: "owner@private.test" },
    ],
    body: {
      data: Buffer.from(
        "PRIVATE_NAME asks to refund ch_private. Bearer credential-canary",
      ).toString("base64url"),
    },
    parts: [
      {
        mimeType: "text/html",
        body: { data: Buffer.from("RAW_HTML").toString("base64url") },
      },
      {
        mimeType: "text/plain",
        filename: "private.txt",
        body: { data: Buffer.from("RAW_ATTACHMENT").toString("base64url") },
      },
    ],
  },
};
function tracing(
  options: Partial<ConstructorParameters<typeof Tracing>[0]> = {},
) {
  return new Tracing({
    source: "support-test",
    upload: false,
    policy,
    aliasKey: key,
    ...options,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("customer-side projection", () => {
  it("accepts the shared Python/backend golden fixture", () => {
    expect(validateEpisode(fixture)).toEqual(fixture);
  });
  it("preserves business facts and consistent local aliases without provider metadata", () => {
    const p = new Projector({
      source: "support",
      episodeKey: "one",
      aliasKey: key,
      policy,
    });
    p.setGoal(
      "PRIVATE_NAME refund ch_private for alice@private.test sk_test_SUPERSECRET",
      ["Preserve the original payment"],
    );
    p.record(
      ["stripe", "customers", "retrieve"],
      { id: customer.id },
      customer,
    );
    p.record(
      ["stripe", "charges", "retrieve"],
      { id: "ch_private" },
      {
        id: "ch_private",
        customer: customer.id,
        amount: 4900,
        amount_refunded: 1200,
        currency: "usd",
        paid: true,
        captured: true,
        metadata: { private: "RAW_METADATA" },
      },
    );
    p.record(
      ["gmail", "messages", "get"],
      { id: message.id, userId: "me" },
      message,
    );
    const output = JSON.stringify(validateEpisode(p.episode));
    for (const canary of [
      "PRIVATE_NAME",
      "alice@private.test",
      "cus_private",
      "ch_private",
      "raw-message-id",
      "raw-thread",
      "PRIVATE_LABEL",
      "RAW_METADATA",
      "RAW_SNIPPET",
      "RAW_MIME",
      "RAW_HTML",
      "RAW_ATTACHMENT",
      "credential-canary",
      "SUPERSECRET",
    ])
      expect(output).not.toContain(canary);
    expect(p.episode.events[1].records[0]).toMatchObject({
      customer: p.episode.events[0].records[0].id,
      amount: 4900,
      amount_refunded: 1200,
    });
    expect(p.episode.goal).toContain(p.episode.events[1].records[0].id);
    expect(p.episode.events[2].records[0].from).toBe(
      p.episode.events[0].records[0].email,
    );
    expect(blockers(p.episode)).toEqual([]);
  });
  it("detaches serialization hooks before validating upload bytes", () => {
    const episode = structuredClone(fixture);
    Object.defineProperty(episode, "toJSON", {
      value: () => ({ secret: "RAW_SERIALIZER_CANARY" }),
      enumerable: false,
    });
    const projected = validateEpisode(episode);
    expect(JSON.stringify(projected)).not.toContain("RAW_SERIALIZER_CANARY");
    expect(projected).toEqual(fixture);
  });
  it("exports no free text by default", () => {
    const p = new Projector({
      source: "support",
      episodeKey: "one",
      aliasKey: key,
      policy: new CapturePolicy(),
    });
    p.setGoal("PRIVATE_GOAL", ["PRIVATE_POLICY"]);
    p.record(["gmail", "messages", "get"], {}, message);
    expect(JSON.stringify(p.episode)).not.toMatch(/PRIVATE_|refund|asks/);
    expect(p.episode.issues).toContain("text_dropped");
    expect(blockers(p.episode)).toContain("missing_goal");
  });
  it("isolates aliases per episode and filter revision", () => {
    const a = new Projector({
        source: "support",
        episodeKey: "a",
        aliasKey: key,
        policy,
      }),
      b = new Projector({
        source: "support",
        episodeKey: "b",
        aliasKey: key,
        policy,
      });
    expect(a.alias("cus", "raw")).not.toBe(b.alias("cus", "raw"));
    expect(new CapturePolicy({ revision: "2" }).fingerprint).not.toBe(
      new CapturePolicy().fingerprint,
    );
    expect(
      new CapturePolicy({ textFields: ["goal", "policy"] }).fingerprint,
    ).toBe(new CapturePolicy({ textFields: ["policy", "goal"] }).fingerprint);
  });
  it("fails closed when customer filtering throws or returns a promise", () => {
    for (const transformText of [
      () => {
        throw new Error("PRIVATE_EXCEPTION");
      },
      (() => Promise.resolve("bad")) as unknown as (s: string) => string,
    ]) {
      const t = tracing({
        policy: new CapturePolicy({ textFields: ["goal"], transformText }),
      });
      t.episode({ goal: "PRIVATE_GOAL" }, () => {});
      expect(t.lastEpisode?.issues).toContain("projection_failed");
      expect(JSON.stringify(t.lastEpisode)).not.toContain("PRIVATE_");
    }
  });
  it.each(["metadata", "raw", "system_prompt", "reasoning"])(
    "rejects arbitrary %s fields before upload",
    (field) => {
      const copy = structuredClone(fixture) as unknown as Record<
        string,
        unknown
      >;
      copy[field] = "canary";
      expect(() => validateEpisode(copy)).toThrow();
    },
  );
  it("rejects resource mismatches, unknown fields and out-of-order sequences", () => {
    for (const mutate of [
      (e: any) => (e.events[0].sequence = 2),
      (e: any) => (e.events[0].provider = "stripe"),
      (e: any) => (e.events[0].records[0].body = "wrong-resource"),
      (e: any) => (e.events[0].records[0].id = "cus_real"),
      (e: any) => (e.events[0].parameters.amount = NaN),
    ]) {
      const copy = structuredClone(fixture);
      mutate(copy);
      expect(() => validateEpisode(copy)).toThrow();
    }
  });
  it("marks limits and incomplete list pages without truncating business facts silently", () => {
    const p = new Projector({
      source: "support",
      episodeKey: "a",
      aliasKey: key,
      policy,
    });
    p.record(
      ["stripe", "customers", "list"],
      {},
      {
        data: Array.from({ length: 51 }, (_, i) => ({
          ...customer,
          id: `cus_${i}`,
        })),
        has_more: true,
      },
    );
    expect(p.episode.issues).toContain("record_limit");
    expect(p.episode.events[0].complete).toBe(false);
    for (let i = 0; i < 101; i++)
      p.record(["stripe", "customers", "retrieve"], {}, customer);
    expect(p.episode.events).toHaveLength(100);
    expect(p.episode.issues).toContain("event_limit");
  });
});
describe("per-client instrumentation", () => {
  it("preserves provider object identity and never adds provider requests", async () => {
    const t = tracing(),
      retrieve = vi.fn(async () => customer),
      original = { customers: { retrieve } },
      wrapped = t.wrapStripe(original);
    await t.episode({ goal: "Resolve issue" }, async () => {
      expect(await wrapped.customers.retrieve()).toBe(customer);
    });
    expect(retrieve).toHaveBeenCalledOnce();
    expect(original.customers.retrieve).toBe(retrieve);
    expect(t.lastEpisode?.events).toHaveLength(1);
    expect(await wrapped.customers.retrieve()).toBe(customer);
    expect(t.lastEpisode?.events).toHaveLength(1);
  });
  it("keeps original errors and records only safe status/code", async () => {
    const t = tracing(),
      error = Object.assign(new Error("RAW_PROVIDER_ERROR Bearer abc"), {
        statusCode: 403,
        code: "private-code",
      });
    const stripe = t.wrapStripe({
      charges: {
        retrieve: async () => {
          throw error;
        },
      },
    });
    await expect(
      t.episode({ goal: "Task" }, () => stripe.charges.retrieve()),
    ).rejects.toBe(error);
    expect(t.lastEpisode?.issues).toContain("agent_error");
    expect(t.lastEpisode?.events[0].error).toEqual({
      category: "permission",
      http_status: 403,
      code: "other",
    });
    expect(JSON.stringify(t.lastEpisode)).not.toContain("RAW_PROVIDER_ERROR");
  });
  it("supports Gmail promise and callback calls without changing responses", async () => {
    const response = { data: message, headers: { secret: "RAW_HEADER" } };
    const raw = {
      users: {
        messages: {
          get: (
            params: unknown,
            callback?: (error: unknown, response: unknown) => void,
          ) =>
            callback
              ? (queueMicrotask(() => callback(null, response)), undefined)
              : Promise.resolve(response),
        },
      },
    };
    const t = tracing(),
      gmail = t.wrapGmail(raw);
    await t.episode({ goal: "Task" }, async () => {
      expect(await gmail.users.messages.get({ id: message.id })).toBe(response);
      await new Promise<void>((resolve) =>
        gmail.users.messages.get({ id: message.id }, (e, r) => {
          expect(r).toBe(response);
          resolve();
        }),
      );
    });
    expect(t.lastEpisode?.events).toHaveLength(2);
    expect(JSON.stringify(t.lastEpisode)).not.toContain("RAW_HEADER");
  });
  it("isolates interleaved asynchronous episodes", async () => {
    const t = tracing(),
      stripe = t.wrapStripe({
        customers: {
          retrieve: async (id: string) => {
            await new Promise((r) => setTimeout(r, 5));
            return { ...customer, id };
          },
        },
      });
    const episodes: unknown[] = [];
    const submit = t.submit.bind(t);
    t.submit = (e) => {
      episodes.push(structuredClone(e));
      return submit(e);
    };
    await Promise.all(
      ["a", "b"].map((id) =>
        t.episode({ goal: id }, () => stripe.customers.retrieve(`cus_${id}`)),
      ),
    );
    expect(episodes).toHaveLength(2);
    for (const episode of episodes as any[])
      expect(episode.events).toHaveLength(1);
  });
  it("allows concurrent reads and marks overlapping mutations", async () => {
    for (const writes of [false, true]) {
      const t = tracing(),
        pending = deferred<typeof customer>(),
        stripe = t.wrapStripe({
          customers: {
            retrieve: () => pending.promise,
            update: () => pending.promise,
          },
        });
      await t.episode({ goal: "Task" }, async () => {
        const a = stripe.customers.retrieve();
        const b = writes
          ? stripe.customers.update()
          : stripe.customers.retrieve();
        pending.resolve(customer);
        await Promise.all([a, b]);
      });
      expect(t.lastEpisode?.issues.includes("source_incomplete")).toBe(writes);
    }
  });
  it("marks unawaited and unsupported calls", async () => {
    const t = tracing(),
      pending = deferred<typeof customer>(),
      stripe = t.wrapStripe({
        customers: { retrieve: () => pending.promise },
        invoices: { retrieve: async () => ({ id: "in_private" }) },
      });
    t.episode({ goal: "Task" }, () => {
      void stripe.customers.retrieve();
    });
    expect(t.lastEpisode?.issues).toContain("source_incomplete");
    pending.resolve(customer);
    await pending.promise;
    await t.episode({ goal: "Task" }, () => stripe.invoices.retrieve());
    expect(t.lastEpisode?.issues).toContain("unsupported_operation");
    // Unknown operations never export arbitrary provider payloads.
    const other = t.wrapStripe({ customers: { erase: async () => ({}) } });
    await t.episode({ goal: "Task" }, () => other.customers.erase());
    expect(t.lastEpisode?.issues).toContain("unsupported_operation");
  });
  it("preserves Stripe pagination helpers while marking their coverage gap", async () => {
    const page = Object.assign(
      Promise.resolve({ data: [customer], has_more: false }),
      { autoPagingToArray: async () => [customer] },
    );
    const t = tracing(),
      stripe = t.wrapStripe({ customers: { list: () => page } });
    await t.episode({ goal: "Task" }, async () => {
      expect(await stripe.customers.list().autoPagingToArray()).toEqual([
        customer,
      ]);
    });
    expect(t.lastEpisode?.issues).toContain("source_incomplete");
  });
});
describe("bounded export", () => {
  const id = "12345678-1234-4234-8234-123456789012";
  it("retries transient failures and returns safe receipts", async () => {
    let n = 0;
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id }), { status: ++n < 3 ? 503 : 201 }),
    );
    const t = tracing({ upload: true, apiKey: "TRACE_SECRET", fetch });
    t.episode({ goal: "Task" }, () => {});
    expect(await t.flush(5000)).toBe(true);
    expect(t.diagnostics()).toMatchObject({
      queued: 1,
      uploaded: 1,
      failed: 0,
    });
    expect(t.recentUploads()).toEqual([
      { id, trainingPath: `/training/${id}` },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    await t.close();
  });
  it("distinguishes drain completion from delivery and bounds the queue", async () => {
    const pending = deferred<Response>(),
      fetch = vi.fn(() => pending.promise),
      t = tracing({
        upload: true,
        apiKey: "TRACE_SECRET",
        queueSize: 1,
        fetch,
      });
    t.episode({ goal: "one" }, () => {});
    t.episode({ goal: "two" }, () => {});
    expect(t.diagnostics().dropped).toBe(1);
    expect(await t.flush(5)).toBe(false);
    pending.resolve(new Response("{}", { status: 403 }));
    expect(await t.close()).toBe(true);
    expect(t.diagnostics()).toMatchObject({ failed: 1, uploaded: 0 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("drains episodes submitted across exporter completion microtasks", async () => {
    const fetch = vi.fn(async () => Response.json({ id }));
    const t = tracing({
      upload: true,
      apiKey: "TRACE_SECRET",
      queueSize: 1000,
      fetch,
    });
    for (let i = 0; i < 100; i++) {
      t.episode({ goal: "Task" }, () => {});
      for (let turn = 0; turn < i % 11; turn++) await Promise.resolve();
    }
    expect(await t.flush(5000)).toBe(true);
    expect(t.diagnostics()).toMatchObject({
      queued: 100,
      uploaded: 100,
      dropped: 0,
      failed: 0,
    });
    await t.close();
  });
  it("rejects nonlocal HTTP and hides explicitly accessed credentials", () => {
    expect(() => tracing({ baseUrl: "http://remote.test" })).toThrow();
    const secret = new Secret("NEVER_PRINT_ME");
    expect(secret.getSecretValue()).toBe("NEVER_PRINT_ME");
    expect(JSON.stringify({ secret }) + inspect(secret)).not.toContain(
      "NEVER_PRINT_ME",
    );
  });
});
