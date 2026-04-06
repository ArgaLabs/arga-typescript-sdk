/**
 * Customer story: before shipping a release, validate the staging environment
 * against the most important user flow and block the release if Arga reports a
 * failed run.
 */

import { Arga } from "../src/index.js";
import { handleFatalError, isMain, printJson, requireEnv } from "./_shared.js";

const releaseValidation = {
  url: process.env.STAGING_URL ?? "https://staging.example.com",
  twins: ["stripe"],
  prompt:
    "Validate sign in, the upgrade flow, and checkout before this release goes live.",
  pollIntervalMs: 2_500,
  timeoutMs: 10 * 60 * 1000,
} as const;

export async function main(): Promise<void> {
  const client = new Arga({
    apiKey: requireEnv("ARGA_API_KEY"),
    ...(process.env.ARGA_BASE_URL ? { baseUrl: process.env.ARGA_BASE_URL } : {}),
  });

  console.log(`Creating a release-gate run for ${releaseValidation.url}...`);

  const run = await client.runs.createUrlRun({
    url: releaseValidation.url,
    prompt: releaseValidation.prompt,
    twins: [...releaseValidation.twins],
  });

  printJson("Created run", run);

  const detail = await client.runs.wait(run.runId, {
    pollInterval: releaseValidation.pollIntervalMs,
    timeout: releaseValidation.timeoutMs,
  });

  printJson("Release gate summary", {
    runId: run.runId,
    status: detail.status,
    runType: detail.runType,
    environmentUrl: detail.environmentUrl,
    failureCategory: detail.failureCategory,
    failureDetail: detail.failureDetail,
  });

  if (detail.resultsJson !== undefined) {
    printJson("resultsJson", detail.resultsJson);
  }

  if (detail.storyJson !== undefined) {
    printJson("storyJson", detail.storyJson);
  }

  const releaseBlocked =
    detail.status !== "completed" ||
    Boolean(detail.failureCategory) ||
    Boolean(detail.failureDetail);

  if (releaseBlocked) {
    throw new Error(
      "Release validation did not finish cleanly. Review the Arga output above before shipping.",
    );
  }

  console.log("\nRelease validation passed. This environment looks ready for the next step.");
}

if (isMain(import.meta.url)) {
  main().catch(handleFatalError);
}
