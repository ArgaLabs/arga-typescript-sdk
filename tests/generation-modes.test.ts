import { describe, expect, it, vi } from "vitest";
import { Arga, type ScenarioGenerationMode } from "../src/index.js";

describe("scenario generation modes", () => {
  const modes: (ScenarioGenerationMode | undefined)[] = [undefined, "fast", "thorough"];

  it.each(modes)("serializes scenario mode %s", async (generationMode) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ id: "scenario-1", name: "Example" }),
    });
    const client = new Arga({ apiKey: "arga_test", fetch });
    await client.scenarios.create({ name: "Example", prompt: "A Slack support channel", generationMode });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      name: "Example", prompt: "A Slack support channel",
      ...(generationMode ? { generation_mode: generationMode } : {}),
    });
  });

  it.each(modes)("serializes twin prompt and mode %s", async (scenarioGenerationMode) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ run_id: "run-1" }),
    });
    const client = new Arga({ apiKey: "arga_test", fetch });
    await client.twins.provision({ twins: ["slack"], scenarioPrompt: "A support channel", scenarioGenerationMode });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      twins: ["slack"], scenario_prompt: "A support channel",
      ...(scenarioGenerationMode ? { scenario_generation_mode: scenarioGenerationMode } : {}),
    });
  });
});
