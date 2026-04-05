import type { HttpClient } from "../http.js";
import { parseSSE, toCamelCaseKeys } from "../http.js";
import { ArgaError } from "../errors.js";
import type {
  CancelRunResponse,
  CreateAgentRunParams,
  CreatePrRunParams,
  CreateUrlRunParams,
  Run,
  RunDetail,
  RunEvent,
  WaitOptions,
} from "../types.js";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "error",
  "timed_out",
]);

export class RunsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a URL run. */
  async createUrlRun(params: CreateUrlRunParams): Promise<Run> {
    return this.http.post<Run>("/validate/url-run", params);
  }

  /** Create a PR run. */
  async createPrRun(params: CreatePrRunParams): Promise<Run> {
    return this.http.post<Run>("/validate/pr-run", params);
  }

  /** Create an agent (sandbox) run. */
  async createAgentRun(params: CreateAgentRunParams): Promise<Run> {
    return this.http.post<Run>("/validate/agent-run", params);
  }

  /** Get full details of a run by ID. */
  async get(runId: string): Promise<RunDetail> {
    return this.http.get<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
  }

  /**
   * Stream run results as Server-Sent Events.
   *
   * Returns an `AsyncIterable<RunEvent>`. Each yielded event contains an
   * optional `event` field and a parsed `data` payload.
   */
  async *streamResults(runId: string): AsyncIterable<RunEvent> {
    const response = await this.http.getRaw(
      `/validate/${encodeURIComponent(runId)}/results`,
    );

    for await (const sse of parseSSE(response)) {
      let data: unknown;
      try {
        data = toCamelCaseKeys(JSON.parse(sse.data));
      } catch {
        data = sse.data;
      }
      yield { event: sse.event, data };
    }
  }

  /** Cancel a run. */
  async cancel(runId: string): Promise<CancelRunResponse> {
    return this.http.post<CancelRunResponse>(
      `/validate/${encodeURIComponent(runId)}/cancel`,
    );
  }

  /**
   * Poll a run until it reaches a terminal status.
   *
   * @param runId  - The run ID to poll.
   * @param opts   - Optional polling configuration.
   * @returns The final `RunDetail` once the run has completed (or failed/cancelled).
   * @throws ArgaError if the timeout is exceeded.
   */
  async wait(runId: string, opts?: WaitOptions): Promise<RunDetail> {
    const pollInterval = opts?.pollInterval ?? 2500;
    const timeout = opts?.timeout ?? 600_000;
    const deadline = Date.now() + timeout;

    while (true) {
      const detail = await this.get(runId);
      if (TERMINAL_STATUSES.has(detail.status)) {
        return detail;
      }
      if (Date.now() + pollInterval > deadline) {
        throw new ArgaError(
          `Timed out waiting for run ${runId} after ${timeout}ms (last status: ${detail.status})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}
