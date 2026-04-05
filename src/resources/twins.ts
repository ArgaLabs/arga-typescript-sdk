import type { HttpClient } from "../http.js";
import type {
  ExtendTwinsParams,
  ExtendTwinsResponse,
  ProvisionTwinsParams,
  ProvisionTwinsResponse,
  Twin,
  TwinProvisionStatus,
} from "../types.js";

export class TwinsResource {
  constructor(private readonly http: HttpClient) {}

  /** List all available twins. */
  async list(): Promise<Twin[]> {
    return this.http.get<Twin[]>("/validate/twins");
  }

  /** Provision a set of twins. */
  async provision(params: ProvisionTwinsParams): Promise<ProvisionTwinsResponse> {
    return this.http.post<ProvisionTwinsResponse>(
      "/validate/twins/provision",
      params,
    );
  }

  /** Get the provisioning status of twins for a given run. */
  async getStatus(runId: string): Promise<TwinProvisionStatus> {
    return this.http.get<TwinProvisionStatus>(
      `/validate/twins/provision/${encodeURIComponent(runId)}/status`,
    );
  }

  /** Extend the TTL of provisioned twins. */
  async extend(
    runId: string,
    params?: ExtendTwinsParams,
  ): Promise<ExtendTwinsResponse> {
    return this.http.post<ExtendTwinsResponse>(
      `/validate/twins/provision/${encodeURIComponent(runId)}/extend`,
      params,
    );
  }
}
