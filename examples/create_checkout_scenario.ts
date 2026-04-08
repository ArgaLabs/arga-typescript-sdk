/**
 * Customer story: create a reusable scenario for a business-critical checkout
 * flow so QA or release automation can reference a shared definition instead of
 * re-describing the flow every time.
 */

import { Arga } from "../src/index.js";
import { handleFatalError, isMain, printJson, requireEnv } from "./_shared.js";

const checkoutScenario = {
  name: "Checkout Upgrade Flow",
  description:
    "Reusable scenario for validating the returning-user upgrade and checkout flow.",
  prompt:
    "Sign in as a returning customer, upgrade from Starter to Pro, complete checkout with Stripe, and verify the confirmation screen and subscription state.",
  twins: ["stripe"],
  tags: ["checkout", "release-gate"],
  seedConfig: {
    user: {
      email: "qa-buyer@example.com",
      isReturningCustomer: true,
    },
    account: {
      currentPlan: "starter",
    },
    cart: {
      items: [{ sku: "pro-monthly", quantity: 1 }],
    },
  },
} as const;

export async function main(): Promise<void> {
  const client = new Arga({
    apiKey: requireEnv("ARGA_API_KEY"),
    ...(process.env.ARGA_BASE_URL ? { baseUrl: process.env.ARGA_BASE_URL } : {}),
  });

  const scenario = await client.scenarios.create({
    name: checkoutScenario.name,
    description: checkoutScenario.description,
    prompt: checkoutScenario.prompt,
    twins: [...checkoutScenario.twins],
    tags: [...checkoutScenario.tags],
    seedConfig: checkoutScenario.seedConfig,
  });

  printJson("Created scenario", scenario);

  console.log(
    `\nSaved scenario ${scenario.id}. Reuse this scenario ID in future validation workflows or docs.`,
  );
}

if (isMain(import.meta.url)) {
  main().catch(handleFatalError);
}
