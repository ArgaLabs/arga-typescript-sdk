import type { HttpClient } from "../http.js";
import type {
  CreateScenarioParams,
  ListScenariosParams,
  Scenario,
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
}
