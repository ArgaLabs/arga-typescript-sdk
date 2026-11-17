import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { gmail } from "@googleapis/gmail";
import Stripe from "stripe";
import { Tracing, CapturePolicy } from "../src/tracing/index.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function endpoint(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
describe("official provider clients", () => {
  it("wraps frozen Gmail resource namespaces and records promise/callback responses", async () => {
    let calls = 0;
    const port = await endpoint((_req, res) => {
      calls++;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "message_private",
          threadId: "thread_private",
          labelIds: ["INBOX"],
        }),
      );
    });
    const original = gmail({
        version: "v1",
        rootUrl: `http://127.0.0.1:${port}/`,
      }),
      tracing = new Tracing({
        source: "gmail-test",
        upload: false,
        policy: new CapturePolicy({ textFields: ["goal"] }),
      }),
      wrapped = tracing.wrapGmail(original);
    expect(
      Object.getOwnPropertyDescriptor(original, "users")?.configurable,
    ).toBe(false);
    expect(wrapped).toBeInstanceOf(original.constructor);
    await tracing.episode({ goal: "Read selected message" }, async () => {
      const response = await wrapped.users.messages.get({
        userId: "me",
        id: "message_private",
      });
      expect(response.data.id).toBe("message_private");
      await new Promise<void>((resolve, reject) =>
        wrapped.users.messages.get(
          { userId: "me", id: "message_private" },
          (err, response) => {
            if (err) reject(err);
            else {
              try {
                expect(response?.data.id).toBe("message_private");
                resolve();
              } catch (error) {
                reject(error);
              }
            }
          },
        ),
      );
    });
    expect(calls).toBe(2);
    expect(tracing.lastEpisode?.events).toHaveLength(2);
    expect(tracing.lastEpisode?.issues).toEqual([]);
  });
  it("wraps Stripe camelCase resources and preserves list helpers and lastResponse", async () => {
    let calls = 0;
    const port = await endpoint((req, res) => {
      calls++;
      res.setHeader("content-type", "application/json");
      res.setHeader("request-id", "req_test");
      res.end(
        JSON.stringify(
          req.url?.startsWith("/v1/charges")
            ? {
                object: "list",
                data: [{ id: "ch_private", amount: 4900, currency: "usd" }],
                has_more: false,
              }
            : {
                id: "pi_private",
                amount: 4900,
                currency: "usd",
                latest_charge: "ch_private",
              },
        ),
      );
    });
    const original = new Stripe("sk_test_fake", {
        host: "127.0.0.1",
        port,
        protocol: "http",
        maxNetworkRetries: 0,
      }),
      tracing = new Tracing({
        source: "stripe-test",
        upload: false,
        policy: new CapturePolicy({ textFields: ["goal"] }),
      }),
      wrapped = tracing.wrapStripe(original);
    await tracing.episode({ goal: "Read selected payment" }, async () => {
      const payment = await wrapped.paymentIntents.retrieve("pi_private");
      expect(payment.lastResponse.requestId).toBe("req_test");
      const page = wrapped.charges.list();
      expect(typeof page.autoPagingEach).toBe("function");
      expect((await page).data).toHaveLength(1);
    });
    expect(calls).toBe(2);
    expect(tracing.lastEpisode?.events).toHaveLength(2);
    expect(tracing.lastEpisode?.events[0].resource).toBe("payment_intents");
    expect(tracing.lastEpisode?.issues).toEqual([]);
  });
});
