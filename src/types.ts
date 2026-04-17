// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface ArgaClientOptions {
  /** Arga API key (starts with `arga_`). */
  apiKey: string;
  /** Base URL for the Arga API. Default: `https://app.argalabs.com` */
  baseUrl?: string;
  /** Custom fetch implementation. Default: global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface CreateUrlRunParams {
  url: string;
  prompt?: string;
  twins?: string[];
  credentials?: { email?: string; password?: string };
  runnerMode?: string;
  sessionId?: string;
  repo?: string;
  branch?: string;
  prUrl?: string;
  provisionId?: string;
}

export interface CreatePrRunParams {
  repo: string;
  branch?: string;
  prUrl?: string;
  contextNotes?: string;
  scenarioPrompt?: string;
  twins?: string[];
  frontendUrl?: string;
  sessionId?: string;
}

export interface CreateAgentRunParams {
  url?: string;
  repo?: string;
  branch?: string;
  credentials?: Record<string, unknown>[];
  focus?: string;
  actionBudget?: number;
  runnerMode?: string;
}

export interface Run {
  runId: string;
  status: string;
  sessionId?: string;
}

export interface StepSummary {
  step: string;
  status: string;
  detail?: string;
}

export interface RunDetail {
  id: string;
  status: string;
  runType?: string;
  mode?: string;
  environmentUrl?: string;
  surfaceUrls?: string[];
  twins?: string[];
  resultsJson?: unknown;
  eventLogJson?: unknown;
  storyJson?: unknown;
  attackPlanJson?: unknown;
  redteamReportJson?: unknown;
  stepSummaries?: StepSummary[];
  failureCategory?: string;
  failureDetail?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface RunEvent {
  event?: string;
  data: unknown;
}

export interface CancelRunResponse {
  status: string;
}

export interface WaitOptions {
  /** Polling interval in milliseconds. Default: 2500. */
  pollInterval?: number;
  /** Maximum wait time in milliseconds. Default: 600000 (10 min). */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Twins
// ---------------------------------------------------------------------------

export interface Twin {
  name: string;
  label: string;
  kind: string;
  showInUi: boolean;
}

export interface ProvisionTwinsParams {
  twins: string[];
  ttlMinutes?: number;
  scenarioId?: string;
  /**
   * Whether the provisioned twins should be reachable via their public
   * `pub-r<id>--<surface>` hosts without proxy auth, so the returned
   * `baseUrl` can be dropped directly into a twin-native SDK (Slack,
   * Stripe, Discord, etc.). Defaults to `true` server-side — pass `false`
   * explicitly if you want to gate the environment behind the proxy token.
   */
  public?: boolean;
}

export interface ProvisionTwinsResponse {
  runId: string;
}

export interface TwinInstance {
  name: string;
  label: string;
  baseUrl: string;
  adminUrl: string;
  envVars: Record<string, string>;
  showInUi: boolean;
}

export interface TwinProvisionStatus {
  runId: string;
  status: string;
  twins: Record<string, TwinInstance>;
  dashboardUrl?: string;
  expiresAt?: string;
  /**
   * Proxy token for hitting each twin's `adminUrl` (and, for private runs,
   * its `baseUrl`). Always returned for ready runs; for public runs the
   * `baseUrl` is directly callable without it, but admin-side ops still
   * need it.
   */
  proxyToken?: string;
  /**
   * Whether the run's `baseUrl`s are the drop-in `pub-r<id>...` hosts. When
   * true, the SDK caller can drop `twin.baseUrl` straight into a native
   * SDK without wiring any proxy token.
   */
  isPublic?: boolean;
  error?: string;
}

export interface ExtendTwinsParams {
  ttlMinutes?: number;
}

export interface ExtendTwinsResponse {
  status: string;
  ttlMinutes: number;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface CreateScenarioParams {
  name: string;
  prompt?: string;
  seedConfig?: Record<string, unknown>;
  twins?: string[];
  description?: string;
  tags?: string[];
}

export interface ListScenariosParams {
  twin?: string;
  tag?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  twins?: string[];
  seedConfig?: Record<string, unknown>;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}
