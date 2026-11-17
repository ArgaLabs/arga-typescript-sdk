import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BraintrustSync,
  projectTrace,
  SyncError,
  type BraintrustRow,
} from "../src/tracing/braintrust.js";
import { CapturePolicy } from "../src/tracing/projection.js";

const projectId = "12345678-1234-4234-8234-123456789012",
  datasetId = "22345678-1234-4234-8234-123456789012";
const policy = new CapturePolicy({
  textFields: ["goal", "policy"],
  revision: "bt-1",
});
const base = {
  source: "braintrust-support",
  projectId,
  aliasKey: Buffer.alloc(32, 4),
  policy,
  goalPointer: "/input/task",
};
function rows(root = "root"): BraintrustRow[] {
  return [
    {
      span_id: root,
      root_span_id: root,
      span_parents: [],
      input: {
        task: "Refund ch_private for user@private.test",
        system: "SYSTEM_CANARY",
      },
      output: "ROOT_OUTPUT_CANARY",
      metrics: { start: 1, end: 10 },
    },
    {
      span_id: `${root}-read`,
      root_span_id: root,
      span_parents: [root],
      span_attributes: { type: "tool", name: "stripe.charges.retrieve" },
      input: {
        id: "ch_private",
        headers: { Authorization: "Bearer PRIVATE_AUTH" },
      },
      output: {
        id: "ch_private",
        amount: 4900,
        amount_refunded: 1200,
        currency: "usd",
        metadata: { private: "RAW_META" },
      },
      metrics: { start: 2, end: 3 },
    },
    {
      span_id: `${root}-llm`,
      root_span_id: root,
      span_parents: [root],
      span_attributes: { type: "llm", name: "stripe.charges.create" },
      input: "RAW_LLM",
      output: "RAW_LLM",
      metrics: { start: 3, end: 4 },
    },
    {
      span_id: `${root}-write`,
      root_span_id: root,
      span_parents: [root],
      span_attributes: { type: "tool", name: "stripe.refunds.create" },
      input: { charge: "ch_private", amount: 3700 },
      output: {
        id: "re_private",
        charge: "ch_private",
        amount: 3700,
        currency: "usd",
        status: "succeeded",
      },
      metrics: { start: 5, end: 6 },
    },
  ];
}
const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function checkpoint() {
  const dir = await mkdtemp(join(tmpdir(), "arga-bt-test-"));
  paths.push(dir);
  return join(dir, "state.json");
}
function worker(
  statePath: string,
  fetch: typeof globalThis.fetch,
  changes: Partial<ConstructorParameters<typeof BraintrustSync>[0]> = {},
) {
  return new BraintrustSync({
    source: base.source,
    projectId,
    braintrustKey: "BT_CREDENTIAL_CANARY",
    argaKey: "ARGA_CREDENTIAL_CANARY",
    statePath,
    since: new Date(0),
    policy,
    goalPointer: "/input/task",
    fetch,
    ...changes,
  });
}

describe("Braintrust projection", () => {
  it("selects executed tool spans, ignores LLM/root output and strips metadata", () => {
    const episode = projectTrace(rows(), base),
      encoded = JSON.stringify(episode);
    expect(episode.events).toHaveLength(2);
    expect(episode.issues).toEqual([]);
    for (const canary of [
      "SYSTEM_CANARY",
      "ROOT_OUTPUT_CANARY",
      "PRIVATE_AUTH",
      "RAW_META",
      "RAW_LLM",
      "ch_private",
      "re_private",
      "user@private.test",
    ])
      expect(encoded).not.toContain(canary);
    expect(episode.events[1].parameters.charge).toBe(
      episode.events[0].records[0].id,
    );
  });
  it.each(["missing parent", "cycle", "multiple roots", "conflict"])(
    "rejects %s",
    (failure) => {
      const spans = rows();
      if (failure === "missing parent") spans[1].span_parents = ["missing"];
      if (failure === "cycle") {
        spans[1].span_parents = ["root-write"];
        spans[3].span_parents = ["root-read"];
      }
      if (failure === "multiple roots") spans[1].span_parents = [];
      if (failure === "conflict")
        spans.push({ ...spans[1], output: { id: "other" } });
      expect(() => projectTrace(spans, base)).toThrow(SyncError);
    },
  );
  it("marks executed unknown tools and unordered mutations without exporting their payload", () => {
    const spans = rows();
    spans[3].metrics = { start: 2.5, end: 5 };
    spans.push({
      span_id: "unknown",
      root_span_id: "root",
      span_parents: ["root"],
      span_attributes: { type: "tool", name: "private-tool" },
      input: "UNKNOWN_CANARY",
      metrics: { start: 6, end: 7 },
    });
    const episode = projectTrace(spans, base);
    expect(episode.issues).toContain("unsupported_operation");
    expect(episode.issues).toContain("source_incomplete");
    expect(JSON.stringify(episode)).not.toContain("UNKNOWN_CANARY");
  });
  it("supports explicit operation maps and JSON pointers", () => {
    const spans = rows();
    spans[1].span_attributes = { type: "tool", name: "get_payment" };
    const episode = projectTrace(spans, {
      ...base,
      operations: { get_payment: "stripe.charges.retrieve" },
    });
    expect(episode.events).toHaveLength(2);
    expect(episode.issues).toEqual([]);
  });
});
describe("durable customer-run sync", () => {
  it("uses complete-trace reads, persists 0600 state, and suppresses replay", async () => {
    const state = await checkpoint(),
      payloads: string[] = [],
      queries: string[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("braintrust.dev")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer BT_CREDENTIAL_CANARY",
        );
        const query = JSON.parse(String(init?.body)).query;
        queries.push(query);
        return Response.json({
          data: query.includes("is_root = true")
            ? [{ root_span_id: "root", created: new Date(1000).toISOString() }]
            : rows(),
        });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer ARGA_CREDENTIAL_CANARY",
      );
      payloads.push(String(init?.body));
      return Response.json({ id: datasetId }, { status: 201 });
    }) as typeof globalThis.fetch;
    const first = await worker(state, fetch).syncOnce({
      until: new Date(120000),
    });
    expect(first).toEqual({
      uploaded: 1,
      unchanged: 0,
      pending: 0,
      coverageGaps: 0,
      caughtUp: true,
    });
    const second = await worker(state, fetch).syncOnce({
      until: new Date(120000),
    });
    expect(second.unchanged).toBe(1);
    expect(second.uploaded).toBe(0);
    expect(payloads).toHaveLength(1);
    const saved = await readFile(state, "utf8");
    for (const canary of [
      "CREDENTIAL_CANARY",
      "RAW_LLM",
      "ch_private",
      "Refund",
    ])
      expect(saved).not.toContain(canary);
    expect((await stat(state)).mode & 0o777).toBe(0o600);
    expect(
      queries.find((q) => q.includes("WHERE root_span_id =")),
    ).not.toContain("created >=");
  });
  it("does not advance on unacknowledged uploads; retry retains aliases", async () => {
    const state = await checkpoint(),
      payloads: string[] = [];
    let ok = false;
    const fetch = (async (url, init) =>
      String(url).includes("braintrust.dev")
        ? Response.json({
            data: JSON.parse(String(init?.body)).query.includes(
              "is_root = true",
            )
              ? [
                  {
                    root_span_id: "root",
                    created: new Date(1000).toISOString(),
                  },
                ]
              : rows(),
          })
        : (payloads.push(String(init?.body)),
          Response.json(ok ? { id: datasetId } : {}, {
            status: ok ? 201 : 503,
          }))) as typeof globalThis.fetch;
    await expect(
      worker(state, fetch).syncOnce({ until: new Date(120000) }),
    ).rejects.toThrow("not acknowledged");
    expect(JSON.parse(await readFile(state, "utf8")).watermark).toBe(
      new Date(0).toISOString(),
    );
    ok = true;
    expect(
      (await worker(state, fetch).syncOnce({ until: new Date(120000) }))
        .uploaded,
    ).toBe(1);
    expect(payloads[0]).toBe(payloads[1]);
  });
  it("retains malformed/unfinished roots while healthy roots progress", async () => {
    const state = await checkpoint();
    let repaired = false;
    const fetch = (async (url, init) => {
      if (!String(url).includes("braintrust.dev"))
        return Response.json({ id: datasetId }, { status: 201 });
      const query = JSON.parse(String(init?.body)).query;
      if (query.includes("is_root = true"))
        return Response.json({
          data: ["unfinished", "broken", "healthy"].map((root_span_id) => ({
            root_span_id,
            created: new Date(1000).toISOString(),
          })),
        });
      const id = query.includes("'unfinished'")
          ? "unfinished"
          : query.includes("'broken'")
            ? "broken"
            : "healthy",
        spans = rows(id);
      if (!repaired && id === "unfinished") spans[0].metrics = { start: 1 };
      if (!repaired && id === "broken") spans[1].span_parents = ["missing"];
      return Response.json({ data: spans });
    }) as typeof globalThis.fetch;
    expect(
      await worker(state, fetch).syncOnce({ until: new Date(120000) }),
    ).toMatchObject({ uploaded: 1, pending: 2, coverageGaps: 1 });
    repaired = true;
    expect(
      await worker(state, fetch).syncOnce({ until: new Date(120000) }),
    ).toMatchObject({ uploaded: 2, pending: 0, unchanged: 1 });
  });
  it("paginates using cursor headers and rejects repeated cursors", async () => {
    const state = await checkpoint();
    let repeated = false;
    const fetch = (async (_url, init) => {
      const query = JSON.parse(String(init?.body)).query;
      if (!query.includes("OFFSET"))
        return Response.json(
          { data: [] },
          { headers: { "x-bt-cursor": "page-2" } },
        );
      return Response.json(
        { data: [] },
        { headers: repeated ? { "x-bt-cursor": "page-2" } : {} },
      );
    }) as typeof globalThis.fetch;
    expect(
      (await worker(state, fetch).syncOnce({ until: new Date(120000) }))
        .uploaded,
    ).toBe(0);
    repeated = true;
    await expect(
      worker(state, fetch).syncOnce({ until: new Date(120000) }),
    ).rejects.toThrow("repeated");
  });
  it("rejects changed configuration, corrupt checkpoints, oversize reads and active locks", async () => {
    const state = await checkpoint(),
      fetch = (async () =>
        Response.json({ data: [] })) as typeof globalThis.fetch;
    await worker(state, fetch).syncOnce({ until: new Date(120000) });
    await expect(
      worker(state, fetch, { source: "other" }).syncOnce(),
    ).rejects.toThrow("configuration changed");
    await writeFile(state + ".lock", "");
    await expect(worker(state, fetch).syncOnce()).rejects.toThrow("locked");
    await rm(state + ".lock");
    const tooLarge = (async () =>
      new Response("x".repeat(2000001))) as typeof globalThis.fetch;
    await expect(worker(state, tooLarge).syncOnce()).rejects.toThrow("exceeds");
    await writeFile(state, "{}");
    await expect(worker(state, fetch).syncOnce()).rejects.toThrow();
  });
  it("reads signed storage redirects without forwarding API credentials or query bodies", async () => {
    const state = await checkpoint();
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (url, init) => {
      requests.push({ url: String(url), init });
      return String(url).includes("api.braintrust.dev")
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                "https://results.s3.amazonaws.com/query.json?signature=opaque",
            },
          })
        : Response.json({ data: [] });
    }) as typeof globalThis.fetch;
    expect(
      (await worker(state, fetch).syncOnce({ until: new Date(120000) }))
        .uploaded,
    ).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].init?.method).toBe("GET");
    expect(requests[1].init?.headers).toBeUndefined();
    expect(requests[1].init?.body).toBeUndefined();
  });
  it("retains an oversized trace while processing healthy roots", async () => {
    const state = await checkpoint();
    const fetch = (async (url, init) => {
      if (!String(url).includes("braintrust.dev"))
        return Response.json({ id: datasetId }, { status: 201 });
      const query = JSON.parse(String(init?.body)).query;
      if (query.includes("is_root = true"))
        return Response.json({
          data: ["large", "healthy"].map((root_span_id) => ({
            root_span_id,
            created: new Date(1000).toISOString(),
          })),
        });
      return Response.json({
        data: query.includes("'large'")
          ? Array.from({ length: 1001 }, () => ({}))
          : rows("healthy"),
      });
    }) as typeof globalThis.fetch;
    expect(
      await worker(state, fetch).syncOnce({ until: new Date(120000) }),
    ).toMatchObject({
      uploaded: 1,
      pending: 1,
      coverageGaps: 1,
      caughtUp: true,
    });
    expect(JSON.parse(await readFile(state, "utf8")).watermark).toBe(
      new Date(120000).toISOString(),
    );
  });
  it("uses EU only for Braintrust and preserves region/destination separation", async () => {
    const state = await checkpoint(),
      urls: string[] = [];
    const fetch = (async (url) => {
      urls.push(String(url));
      return Response.json({ data: [] });
    }) as typeof globalThis.fetch;
    await worker(state, fetch, { region: "eu" }).syncOnce({
      until: new Date(120000),
    });
    expect(urls).toEqual(["https://api-eu.braintrust.dev/btql"]);
  });
});
