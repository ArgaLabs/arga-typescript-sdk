import type { HttpClient } from "../http.js";
import type {
  CreateTwinRunParams,
  ProvisionTwinsResponse,
  TwinProvisionStatus,
  ResetTwinsResponse,
  ExtendTwinsResponse,
  WaitOptions,
} from "../types.js";
import { segment, poll } from "./common.js";

export class TwinRunsResource {
  constructor(private readonly http: HttpClient) {}
  create(params: CreateTwinRunParams): Promise<ProvisionTwinsResponse> {
    return this.http.post("/twin-runs", params);
  }
  get(id: string): Promise<TwinProvisionStatus> {
    return this.http.get(`/twin-runs/${segment(id)}`);
  }
  extend(
    id: string,
    params: { ttlMinutes?: number } = {},
  ): Promise<ExtendTwinsResponse> {
    return this.http.post(`/twin-runs/${segment(id)}/extend`, {
      ttlMinutes: params.ttlMinutes ?? 60,
    });
  }
  teardown(id: string): Promise<Record<string, unknown>> {
    return this.http.post(`/twin-runs/${segment(id)}/teardown`);
  }
  lock(id: string): Promise<Record<string, unknown>> {
    return this.http.post(`/twin-runs/${segment(id)}/lock`);
  }
  reset(id: string): Promise<ResetTwinsResponse> {
    return this.http.post(`/validate/twins/provision/${segment(id)}/reset`);
  }
  microsoftScenarioSnapshot(id: string): Promise<Record<string, unknown>> {
    return this.http.get(
      `/twin-runs/${segment(id)}/microsoft-scenario-snapshot`,
    );
  }
  wait(id: string, options?: WaitOptions): Promise<TwinProvisionStatus> {
    return poll(
      () => this.get(id),
      new Set([
        "ready",
        "failed",
        "cancelled",
        "canceled",
        "expired",
        "torn_down",
        "error",
        "timed_out",
      ]),
      options,
    );
  }
}
