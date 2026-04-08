/**
 * Customer story: provision disposable versions of external dependencies before
 * a test run, then copy the returned URLs and env vars into a staging or QA
 * environment.
 */

import { Arga, type TwinProvisionStatus } from "../src/index.js";
import { handleFatalError, isMain, printJson, requireEnv } from "./_shared.js";

const twinSetup = {
  twins: ["stripe"],
  ttlMinutes: 60,
  pollIntervalMs: 5_000,
  timeoutMs: 5 * 60 * 1000,
} as const;

const terminalStatuses = new Set([
  "ready",
  "failed",
  "cancelled",
  "canceled",
  "error",
  "timed_out",
  "expired",
]);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(client: Arga, runId: string): Promise<TwinProvisionStatus> {
  const deadline = Date.now() + twinSetup.timeoutMs;

  while (true) {
    const status = await client.twins.getStatus(runId);
    console.log(`Twin provisioning status: ${status.status}`);

    if (status.error || terminalStatuses.has(status.status)) {
      return status;
    }

    if (Date.now() + twinSetup.pollIntervalMs > deadline) {
      throw new Error(
        `Timed out waiting for twins to be ready after ${twinSetup.timeoutMs}ms.`,
      );
    }

    await sleep(twinSetup.pollIntervalMs);
  }
}

export async function main(): Promise<void> {
  const client = new Arga({
    apiKey: requireEnv("ARGA_API_KEY"),
    ...(process.env.ARGA_BASE_URL ? { baseUrl: process.env.ARGA_BASE_URL } : {}),
  });

  const provisioned = await client.twins.provision({
    twins: [...twinSetup.twins],
    ttlMinutes: twinSetup.ttlMinutes,
  });

  printJson("Provision request accepted", provisioned);

  const status = await waitForReady(client, provisioned.runId);

  printJson("Provisioning summary", {
    runId: status.runId,
    status: status.status,
    dashboardUrl: status.dashboardUrl,
    expiresAt: status.expiresAt,
  });

  if (status.error) {
    throw new Error(`Twin provisioning failed: ${status.error}`);
  }

  for (const [name, twin] of Object.entries(status.twins)) {
    printJson(`${name} twin`, {
      baseUrl: twin.baseUrl,
      adminUrl: twin.adminUrl,
      envVars: twin.envVars,
    });
  }

  console.log(
    "\nCopy the env vars above into your staging or QA environment before running the dependent flow.",
  );
}

if (isMain(import.meta.url)) {
  main().catch(handleFatalError);
}
