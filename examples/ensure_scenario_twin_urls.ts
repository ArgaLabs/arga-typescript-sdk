import { Arga } from "../src/index.js";
import { handleFatalError, isMain, printJson, requireEnv } from "./_shared.js";

const scenarioTwinUrls = {
  scenarioId: process.env.ARGA_SCENARIO_ID ?? "replace-with-scenario-id",
  // Leave empty to use the twins saved on the scenario.
  twins: ["stripe", "slack"],
};

export async function main(): Promise<void> {
  const client = new Arga({
    apiKey: requireEnv("ARGA_API_KEY"),
    baseUrl: process.env.ARGA_BASE_URL ?? "https://app.argalabs.com",
  });

  const env = await client.scenarios.ensureTwinEnvironment(scenarioTwinUrls.scenarioId, {
    twins: scenarioTwinUrls.twins,
    public: true,
  });

  printJson("Permanent scenario twin environment", env);
  for (const [name, twin] of Object.entries(env.twins ?? {})) {
    console.log(`${name}: ${twin.baseUrl}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch(handleFatalError);
}
