import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as createCheckoutScenario from "../examples/create_checkout_scenario.js";
import * as exploreStagingWithAgent from "../examples/explore_staging_with_agent.js";
import * as provisionCheckoutTwins from "../examples/provision_checkout_twins.js";
import * as validateStagingRelease from "../examples/validate_staging_release.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCliPath = resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");

function runExample(exampleFile: string) {
  return spawnSync(process.execPath, [tsxCliPath, exampleFile], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ARGA_API_KEY: "",
    },
    encoding: "utf8",
  });
}

describe("examples smoke test", () => {
  it("imports example modules without executing them", () => {
    expect(typeof validateStagingRelease.main).toBe("function");
    expect(typeof createCheckoutScenario.main).toBe("function");
    expect(typeof provisionCheckoutTwins.main).toBe("function");
    expect(typeof exploreStagingWithAgent.main).toBe("function");
  });

  it("prints setup guidance when an example is run without an API key", () => {
    for (const exampleFile of [
      "examples/validate_staging_release.ts",
      "examples/create_checkout_scenario.ts",
      "examples/provision_checkout_twins.ts",
      "examples/explore_staging_with_agent.ts",
    ]) {
      const result = runExample(exampleFile);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "Set ARGA_API_KEY before running this example. See examples/README.md for setup details.",
      );
    }
  });
});
