import type { HttpClient } from "../http.js";
import type {
  CreateTestRunParams,
  TestRunOverrides,
  TestRun,
  WaitOptions,
} from "../types.js";
import { segment, artifactPath, poll } from "./common.js";

export class TestRunsResource {
  constructor(private readonly http: HttpClient) {}
  create(params: CreateTestRunParams): Promise<TestRun> {
    return this.http.post("/test-runs", params);
  }
  async list(): Promise<TestRun[]> {
    return (await this.http.get<{ runs: TestRun[] }>("/test-runs")).runs;
  }
  get(id: string): Promise<TestRun> {
    return this.http.get(`/test-runs/${segment(id)}`);
  }
  rerun(id: string, overrides: TestRunOverrides = {}): Promise<TestRun> {
    return this.http.post(`/test-runs/${segment(id)}/rerun`, overrides);
  }
  updateConfig(
    id: string,
    testConfig: Record<string, unknown>,
  ): Promise<TestRun> {
    return this.http.patch(`/test-runs/${segment(id)}/config`, { testConfig });
  }
  sendMessage(id: string, message: string): Promise<TestRun> {
    return this.http.post(`/test-runs/${segment(id)}/messages`, { message });
  }
  artifactUrl(id: string, filename: string): Promise<string> {
    return this.http.getRedirect(
      `/test-runs/${segment(id)}/artifacts/${artifactPath(filename)}`,
    );
  }
  wait(id: string, options?: WaitOptions): Promise<TestRun> {
    return poll(
      () => this.get(id),
      new Set(["completed", "failed", "cancelled"]),
      options,
    );
  }
}
