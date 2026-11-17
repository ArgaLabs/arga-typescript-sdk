#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { BraintrustSync, SyncError } from "./braintrust.js";
import { CapturePolicy } from "./projection.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      source: { type: "string" },
      state: { type: "string" },
      since: { type: "string" },
      policy: { type: "string" },
      region: { type: "string", default: "us" },
      "base-url": { type: "string", default: "https://api.argalabs.com" },
      watch: { type: "boolean", default: false },
      "poll-interval": { type: "string", default: "30" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: arga-braintrust-sync --project UUID --source NAME --state PATH --since ISO_TIMESTAMP --policy policy.json [--region us|eu] [--watch] [--poll-interval SECONDS]

Reads BRAINTRUST_API_KEY and ARGA_TRACE_KEY from the environment.
Filtering, aliases and checkpoint state remain on this host. Policy JSON accepts
text_fields, revision, goal_pointer, policies and operations. Free text is opt-in.
For customer-specific text filters use the programmatic BraintrustSync API.`);
    return;
  }
  if (
    !values.project ||
    !values.source ||
    !values.state ||
    !values.since ||
    !values.policy
  )
    throw new SyncError(
      "Provide --project, --source, --state, --since and --policy; see --help",
    );
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(values.since) ||
    !Number.isFinite(Date.parse(values.since))
  )
    throw new SyncError("Use an ISO --since timestamp with a timezone");
  const interval = Number(values["poll-interval"]);
  if (!Number.isFinite(interval) || interval < 1 || interval > 3600)
    throw new SyncError("Use a poll interval between 1 and 3600 seconds");
  if ((await stat(values.policy)).size > 64000)
    throw new SyncError("Policy exceeds its local limit");
  const config = JSON.parse(await readFile(values.policy, "utf8"));
  const allowed = new Set([
    "text_fields",
    "revision",
    "goal_pointer",
    "policies",
    "operations",
  ]);
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).some((k) => !allowed.has(k)) ||
    (config.goal_pointer !== undefined &&
      typeof config.goal_pointer !== "string") ||
    (config.revision !== undefined && typeof config.revision !== "string") ||
    (config.text_fields !== undefined &&
      (!Array.isArray(config.text_fields) ||
        config.text_fields.some((v: unknown) => typeof v !== "string"))) ||
    (config.policies !== undefined &&
      (!Array.isArray(config.policies) ||
        config.policies.some((v: unknown) => typeof v !== "string"))) ||
    (config.operations !== undefined &&
      (!config.operations ||
        typeof config.operations !== "object" ||
        Array.isArray(config.operations) ||
        Object.values(config.operations).some((v) => typeof v !== "string")))
  )
    throw new SyncError("Invalid local policy JSON");
  const sync = new BraintrustSync({
    source: values.source,
    projectId: values.project,
    statePath: values.state,
    since: new Date(values.since),
    policy: new CapturePolicy({
      textFields: config.text_fields,
      revision: config.revision,
    }),
    goalPointer: config.goal_pointer,
    policies: config.policies,
    operations: config.operations,
    region: values.region as "us" | "eu",
    baseUrl: values["base-url"],
    braintrustKey: process.env.BRAINTRUST_API_KEY ?? "",
    argaKey: process.env.ARGA_TRACE_KEY ?? "",
  });
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let failures = 0;
  const pause = (seconds: number) =>
    new Promise<void>((resolve) => {
      if (stopping) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, seconds * 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  try {
    do {
      try {
        const counters = await sync.syncOnce();
        failures = 0;
        console.log(JSON.stringify(counters));
        if (!values.watch || stopping) break;
        if (counters.caughtUp) await pause(interval);
      } catch (error) {
        if (!values.watch) throw error;
        console.error(
          error instanceof SyncError
            ? error.message
            : "Sync pass failed; checkpoint retained",
        );
        await pause(Math.min(300, interval * 2 ** Math.min(failures++, 8)));
      }
    } while (!stopping);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
main().catch((error) => {
  console.error(
    error instanceof SyncError
      ? error.message
      : "Sync could not start; check local configuration and credentials",
  );
  process.exitCode = 1;
});
