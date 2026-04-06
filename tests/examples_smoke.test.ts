import { describe, expect, it } from "vitest";

import * as createCheckoutScenario from "../examples/create_checkout_scenario.js";
import * as exploreStagingWithAgent from "../examples/explore_staging_with_agent.js";
import * as provisionCheckoutTwins from "../examples/provision_checkout_twins.js";
import * as validateStagingRelease from "../examples/validate_staging_release.js";

describe("examples smoke test", () => {
  it("imports example modules without executing them", () => {
    expect(typeof validateStagingRelease.main).toBe("function");
    expect(typeof createCheckoutScenario.main).toBe("function");
    expect(typeof provisionCheckoutTwins.main).toBe("function");
    expect(typeof exploreStagingWithAgent.main).toBe("function");
  });
});
