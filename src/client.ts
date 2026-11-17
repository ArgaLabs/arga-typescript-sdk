import { HttpClient } from "./http.js";
import { RunsResource } from "./resources/runs.js";
import { TwinsResource } from "./resources/twins.js";
import { ScenariosResource } from "./resources/scenarios.js";
import type { ArgaClientOptions } from "./types.js";
import { TwinRunsResource } from "./resources/twin-runs.js";
import { TestRunsResource } from "./resources/test-runs.js";
import { TestsResource } from "./resources/tests.js";
import { TrainingResource } from "./training.js";

const DEFAULT_BASE_URL = "https://api.argalabs.com";

/**
 * Main client for the Arga API.
 *
 * ```ts
 * import { Arga } from 'arga-sdk';
 *
 * const client = new Arga({ apiKey: 'arga_...' });
 * const run = await client.runs.createUrlRun({ url: 'https://staging.myapp.com' });
 * ```
 */
export class Arga {
  readonly twinRuns: TwinRunsResource;
  readonly testRuns: TestRunsResource;
  readonly tests: TestsResource;
  readonly training: TrainingResource;
  /** Run management: create, get, stream, cancel, and wait for runs. */
  readonly runs: RunsResource;
  /** Twin management: list, provision, check status, and extend twins. */
  readonly twins: TwinsResource;
  /** Scenario management: create, list, and get scenarios. */
  readonly scenarios: ScenariosResource;

  constructor(options: ArgaClientOptions) {
    const http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      timeout: options.timeout,
    });

    this.runs = new RunsResource(http);
    this.twins = new TwinsResource(http);
    this.scenarios = new ScenariosResource(http);
    this.twinRuns = new TwinRunsResource(http);
    this.testRuns = new TestRunsResource(http);
    this.tests = new TestsResource(http);
    this.training = new TrainingResource(http);
  }
}
