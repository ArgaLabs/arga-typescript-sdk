import { HttpClient } from "./http.js";
import { RunsResource } from "./resources/runs.js";
import { TwinsResource } from "./resources/twins.js";
import { ScenariosResource } from "./resources/scenarios.js";
import type { ArgaClientOptions } from "./types.js";

const DEFAULT_BASE_URL = "https://app.argalabs.com";

/**
 * Main client for the Arga API.
 *
 * ```ts
 * import { Arga } from 'arga';
 *
 * const client = new Arga({ apiKey: 'arga_...' });
 * const run = await client.runs.createUrlRun({ url: 'https://staging.myapp.com' });
 * ```
 */
export class Arga {
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
    });

    this.runs = new RunsResource(http);
    this.twins = new TwinsResource(http);
    this.scenarios = new ScenariosResource(http);
  }
}
