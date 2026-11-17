import { afterEach, expect, it, vi } from "vitest";
import { poll } from "../src/resources/common.js";
import { Arga } from "../src/index.js";
afterEach(() => vi.useRealTimers());
it.each([
  { pollInterval: 0 },
  { pollInterval: Infinity },
  { timeout: 0 },
  { timeout: NaN },
])("rejects invalid polling bounds %j", async (options) => {
  await expect(
    poll(async () => ({ status: "ready" }), new Set(["ready"]), options),
  ).rejects.toThrow("finite and positive");
});
it("reports the last status and configured timeout after polling expires", async () => {
  await expect(
    poll(async () => ({ status: "queued" }), new Set(["ready"]), {
      pollInterval: 5,
      timeout: 5,
    }),
  ).rejects.toThrow("after 5ms (last status: queued)");
});
it.each([
  ["twinRuns", "canceled"],
  ["testRuns", "canceled"],
  ["testRuns", "timed_out"],
  ["twinRuns", "ready"],
])("returns terminal %s status %s", async (resource, status) => {
  const fetch = vi.fn(async () =>
      Response.json({ id: "run", run_id: "run", status, twins: {} }),
    ),
    client = new Arga({ apiKey: "test", fetch });
  expect(
    (
      await (client as any)[resource].wait("run", {
        timeout: 50,
        pollInterval: 5,
      })
    ).status,
  ).toBe(status);
  expect(fetch).toHaveBeenCalledOnce();
});
it("clamps long timer intervals instead of overflowing into rapid polls", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const pending = poll(
    async () => ({ status: ++calls === 1 ? "queued" : "ready" }),
    new Set(["ready"]),
    { pollInterval: Number.MAX_SAFE_INTEGER, timeout: Number.MAX_SAFE_INTEGER },
  );
  await vi.advanceTimersByTimeAsync(2147483647);
  expect((await pending).status).toBe("ready");
  expect(calls).toBe(2);
});
