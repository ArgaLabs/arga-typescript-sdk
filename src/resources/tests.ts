import type { HttpClient } from "../http.js";
import type {
  CreateSavedTestParams,
  SavedTest,
  SavedTestRunOverrides,
  TestRun,
  UpdateSavedTestParams,
} from "../types.js";
import { segment } from "./common.js";

export class TestsResource {
  constructor(private readonly http: HttpClient) {}
  create(params: CreateSavedTestParams): Promise<SavedTest> {
    return this.http.post("/tests", params);
  }
  async list(params: { repoFullName?: string } = {}): Promise<SavedTest[]> {
    return (
      await this.http.get<{ tests: SavedTest[] }>(
        "/tests",
        params.repoFullName === undefined
          ? undefined
          : { repo_full_name: params.repoFullName },
      )
    ).tests;
  }
  get(id: string): Promise<SavedTest> {
    return this.http.get(`/tests/${segment(id)}`);
  }
  update(id: string, changes: UpdateSavedTestParams): Promise<SavedTest> {
    return this.http.patch(`/tests/${segment(id)}`, changes);
  }
  delete(id: string): Promise<Record<string, unknown>> {
    return this.http.delete(`/tests/${segment(id)}`);
  }
  run(id: string, overrides: SavedTestRunOverrides = {}): Promise<TestRun> {
    return this.http.post(`/tests/${segment(id)}/run`, overrides);
  }
}
