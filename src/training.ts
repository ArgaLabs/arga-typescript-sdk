import { inspect } from "node:util";
import type { HttpClient } from "./http.js";
import type {
  TrainingDataset,
  TrainingDatasetDetail,
  TrainingTask,
  ScenarioTwinEnvironment,
  EvidenceReceipt,
  GraderArtifact,
  GraderResult,
} from "./types.js";
import { segment } from "./resources/common.js";
import { validateEpisode, type Episode } from "./tracing/models.js";

/** Explicit access prevents accidental console/JSON logging of upload credentials. */
export class Secret {
  #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  getSecretValue(): string {
    return this.#value;
  }
  toString(): string {
    return "[redacted]";
  }
  toJSON(): string {
    return "[redacted]";
  }
  [inspect.custom](): string {
    return "Secret([redacted])";
  }
}
export interface EvidenceUploadKey {
  key: Secret;
  source: string;
  expiresAt: string;
  scope: string;
}
export class TrainingResource {
  constructor(private readonly http: HttpClient) {}
  async createUploadKey(params: {
    source: string;
  }): Promise<EvidenceUploadKey> {
    const result = await this.http.post<
      Omit<EvidenceUploadKey, "key"> & { key: string }
    >("/datasets/evidence-key", params);
    return { ...result, key: new Secret(result.key) };
  }
  uploadEvidence(episode: Episode): Promise<EvidenceReceipt> {
    return this.http.postEvidence(validateEpisode(episode));
  }
  list(
    params: { limit?: number; offset?: number } = {},
  ): Promise<TrainingDataset[]> {
    return this.http.get("/datasets", {
      limit: String(params.limit ?? 50),
      offset: String(params.offset ?? 0),
    });
  }
  get(id: string): Promise<TrainingDatasetDetail> {
    return this.http.get(`/datasets/${segment(id)}`);
  }
  generateTask(
    id: string,
    params: { traceId: string; variation?: string },
  ): Promise<TrainingTask> {
    return this.http.post(`/datasets/${segment(id)}/tasks`, {
      variation: "",
      ...params,
    });
  }
  updateTask(
    id: string,
    task: string,
    params: { revision: number; spec: Record<string, unknown> },
  ): Promise<TrainingTask> {
    return this.http.put(this.path(id, task), params);
  }
  reviewTask(
    id: string,
    task: string,
    params: {
      revision: number;
      decision: "approved" | "rejected";
      acknowledgeAssumptions?: boolean;
      acknowledgeGrader?: boolean;
    },
  ): Promise<TrainingTask> {
    return this.http.post(`${this.path(id, task)}/review`, {
      acknowledgeAssumptions: false,
      acknowledgeGrader: false,
      ...params,
    });
  }
  prepareGrader(
    id: string,
    task: string,
    params: { revision: number },
  ): Promise<TrainingTask> {
    return this.http.post(`${this.path(id, task)}/grader`, params);
  }
  getGrader(id: string, task: string): Promise<GraderArtifact> {
    return this.http.get(`${this.path(id, task)}/grader`);
  }
  testGrader(
    id: string,
    task: string,
    params: {
      revision: number;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
  ): Promise<GraderResult> {
    return this.http.post(`${this.path(id, task)}/grader/test`, params);
  }
  createEnvironment(
    id: string,
    task: string,
  ): Promise<ScenarioTwinEnvironment> {
    return this.http.post(`${this.path(id, task)}/environment`);
  }
  exportJsonl(id: string): Promise<string> {
    return this.http.getText(`/datasets/${segment(id)}/export`);
  }
  private path(id: string, task: string): string {
    return `/datasets/${segment(id)}/tasks/${segment(task)}`;
  }
}
