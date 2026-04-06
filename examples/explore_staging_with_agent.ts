/**
 * Customer story: let Arga explore a staging environment autonomously with a
 * focused objective, then review the high-signal artifacts it returns before
 * handing the build to QA or release managers.
 */

import { Arga } from "../src/index.js";
import { handleFatalError, isMain, printJson, requireEnv } from "./_shared.js";

const agentRun = {
  url: process.env.STAGING_URL ?? "https://staging.example.com",
  focus:
    "Explore onboarding, sign in, and the first purchase flow. Look for dead ends, broken states, and obvious regressions.",
  actionBudget: 80,
  pollIntervalMs: 2_500,
  timeoutMs: 10 * 60 * 1000,
} as const;

export async function main(): Promise<void> {
  const client = new Arga({
    apiKey: requireEnv("ARGA_API_KEY"),
    ...(process.env.ARGA_BASE_URL ? { baseUrl: process.env.ARGA_BASE_URL } : {}),
  });

  const run = await client.runs.createAgentRun({
    url: agentRun.url,
    focus: agentRun.focus,
    actionBudget: agentRun.actionBudget,
  });

  printJson("Created agent run", run);

  const detail = await client.runs.wait(run.runId, {
    pollInterval: agentRun.pollIntervalMs,
    timeout: agentRun.timeoutMs,
  });

  printJson("Agent exploration summary", {
    runId: run.runId,
    status: detail.status,
    runType: detail.runType,
    environmentUrl: detail.environmentUrl,
    failureCategory: detail.failureCategory,
    failureDetail: detail.failureDetail,
  });

  if (detail.storyJson !== undefined) {
    printJson("storyJson", detail.storyJson);
  }

  if (detail.resultsJson !== undefined) {
    printJson("resultsJson", detail.resultsJson);
  }

  if (detail.attackPlanJson !== undefined) {
    printJson("attackPlanJson", detail.attackPlanJson);
  }

  if (detail.redteamReportJson !== undefined) {
    printJson("redteamReportJson", detail.redteamReportJson);
  }

  if (detail.status !== "completed") {
    throw new Error(
      "The agent run did not complete successfully. Review the artifacts above before acting on the environment.",
    );
  }
}

if (isMain(import.meta.url)) {
  main().catch(handleFatalError);
}
