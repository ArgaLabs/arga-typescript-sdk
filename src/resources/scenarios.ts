import type { HttpClient } from "../http.js";
import type {
  CreateScenarioParams,
  EnsureScenarioTwinEnvironmentParams,
  ListScenariosParams,
  Scenario,
  ScenarioTwinEnvironment,
} from "../types.js";

export class ScenariosResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a new scenario. */
  async create(params: CreateScenarioParams): Promise<Scenario> {
    return this.http.post<Scenario>("/scenarios", params);
  }

  /** List scenarios, optionally filtered by twin or tag. */
  async list(params?: ListScenariosParams): Promise<Scenario[]> {
    const query: Record<string, string> = {};
    if (params?.twin) query.twin = params.twin;
    if (params?.tag) query.tag = params.tag;
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
  async getTwinEnvironment(scenarioId: string): Promise<ScenarioTwinEnvironment> {
    return this.http.get<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment`,
    );
  }

  /** Reseed a ready scenario twin environment from its scenario config. */
  async reseedTwinEnvironment(scenarioId: string): Promise<ScenarioTwinEnvironment> {
    return this.http.post<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment/reseed`,
    );
  }

  /** Tear down a scenario's long-lived twin environment. */
  async deleteTwinEnvironment(scenarioId: string): Promise<ScenarioTwinEnvironment> {
    return this.http.delete<ScenarioTwinEnvironment>(
      `/scenarios/${encodeURIComponent(scenarioId)}/twin-environment`,
    );
  }

  /** List all long-lived scenario twin environments. */
  async listTwinEnvironments(): Promise<ScenarioTwinEnvironment[]> {
    return this.http.get<ScenarioTwinEnvironment[]>("/scenario-twin-environments");
  }
}
