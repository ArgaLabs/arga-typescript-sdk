import type { HttpClient } from "../http.js";
import type {
  CreateScenarioParams,
  EnsureScenarioTwinEnvironmentParams,
  ListScenariosParams,
  Scenario,
  ScenarioTwinEnvironment,
} from "../types.js";
import type { UpdateScenarioParams } from "../types.js";
import { segment } from "./common.js";

export class ScenariosResource {
  constructor(private readonly http: HttpClient) {}

  update(id: string, changes: UpdateScenarioParams): Promise<Scenario> {
    return this.http.put(`/scenarios/${segment(id)}`, changes);
  }
  delete(id: string): Promise<Record<string, unknown>> {
    return this.http.delete(`/scenarios/${segment(id)}`);
  }
  copy(id: string, params: { name?: string } = {}): Promise<Scenario> {
    return this.http.post(`/scenarios/${segment(id)}/copy`, params);
  }
  listPresets(
    params: Pick<ListScenariosParams, "twin" | "tag"> = {},
  ): Promise<Scenario[]> {
    return this.http.get(
      "/scenarios/presets",
      Object.fromEntries(
        Object.entries({ twin: params.twin, tag: params.tag }).filter(
          ([, v]) => v !== undefined,
        ),
      ) as Record<string, string>,
    );
  }
  getPreset(id: string): Promise<Scenario> {
    return this.http.get(`/scenarios/presets/${segment(id)}`);
  }
  listLongRuns(
    params: { limit?: number; offset?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    return this.http.get("/scenarios/long-runs", {
      limit: String(params.limit ?? 50),
      offset: String(params.offset ?? 0),
    });
  }

  /** Create a new scenario. */
  async create(params: CreateScenarioParams): Promise<Scenario> {
    return this.http.post<Scenario>("/scenarios", params);
  }

  /** List scenarios, optionally filtered by twin or tag. */
  async list(params?: ListScenariosParams): Promise<Scenario[]> {
    const query: Record<string, string> = {};
    if (params?.twin) query.twin = params.twin;
    if (params?.tag) query.tag = params.tag;
    for (const [key, wire] of Object.entries({
      scope: "scope",
      includePresets: "include_presets",
      limit: "limit",
      offset: "offset",
      search: "search",
    })) {
      const item = params?.[key as keyof ListScenariosParams];
      if (item !== undefined) query[wire] = String(item);
    }
    return this.http.get<Scenario[]>("/scenarios", query);
  }

  /** Get a scenario by ID. */
  async get(scenarioId: string): Promise<Scenario> {
    return this.http.get<Scenario>(
      `/scenarios/${encodeURIComponent(scenarioId)}`,
    );
  }

  /** Create or return a scenario's long-lived twin environment. */
  async ensureTwinEnvironment(
    scenarioId: string,
    params?: EnsureScenarioTwinEnvironmentParams,
  ): Promise<ScenarioTwinEnvironment> {
    return this.http.post<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment`,
      { public: params?.public ?? true, twins: params?.twins },
    );
  }

  /** Get status and URLs for a scenario's long-lived twin environment. */
  async getTwinEnvironment(
    scenarioId: string,
  ): Promise<ScenarioTwinEnvironment> {
    return this.http.get<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment`,
    );
  }

  /** Reseed a ready scenario twin environment from its scenario config. */
  async reseedTwinEnvironment(
    scenarioId: string,
  ): Promise<ScenarioTwinEnvironment> {
    return this.http.post<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment/reseed`,
    );
  }

  /** Tear down a scenario's long-lived twin environment. */
  async deleteTwinEnvironment(
    scenarioId: string,
  ): Promise<ScenarioTwinEnvironment> {
    return this.http.delete<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment`,
    );
  }

  /** List all long-lived scenario twin environments. */
  async listTwinEnvironments(): Promise<ScenarioTwinEnvironment[]> {
    return this.http.get<ScenarioTwinEnvironment[]>(
      "/scenario-twin-environments",
    );
  }
}
