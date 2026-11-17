// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface ArgaClientOptions {
  /** Arga API key (starts with `arga_`). */
  apiKey: string;
  /** Base URL for the Arga API. Default: `https://api.argalabs.com` */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 300000 (generation can take 240s). */
  timeout?: number;
  /** Custom fetch implementation. Default: global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** v0.2 canonical API models. Customer-owned JSON keeps its original keys. */
export interface CreateTwinRunParams extends ProvisionTwinsParams {
  accessProfile?: "full" | "candidate_api_only";
  githubActionsMode?: "simulated" | "execute";
}
export interface TestRunOverrides {
  prompt?: string | null;
  startUrl?: string | null;
  sandboxId?: string | null;
  repo?: string | null;
  branch?: string | null;
  prUrl?: string | null;
  scenarioId?: string | null;
  scenarioPrompt?: string | null;
  twins?: TwinName[] | null;
  ttlMinutes?: number | null;
  triggerSource?: string | null;
}
export interface CreateTestRunParams extends TestRunOverrides {
  prompt: string;
  testConfig?: Record<string, unknown> | null;
}
export interface TestRun {
  id: string;
  status: string;
  prompt?: string | null;
  startUrl?: string | null;
  mode?: string;
  testConfigJson?: Record<string, unknown> | null;
  result?: unknown;
  eventsJson?: Record<string, unknown>[];
  artifactsJson?: Record<string, unknown>;
  summaryText?: string | null;
  errorMessage?: string | null;
  failureDetail?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}
export interface UpdateSavedTestParams {
  name?: string | null;
  description?: string | null;
  prompt?: string | null;
  startUrl?: string | null;
  testConfig?: Record<string, unknown> | null;
  repoFullName?: string | null;
  ciEnabled?: boolean | null;
  credentials?: Record<string, string> | null;
  tags?: string[] | null;
}
export interface CreateSavedTestParams extends UpdateSavedTestParams {
  name: string;
  runId?: string | null;
}
export interface SavedTestRunOverrides extends TestRunOverrides {
  sessionId?: string | null;
}
export interface SavedTest {
  id: string;
  name: string;
  prompt?: string;
  startUrl?: string;
  testConfigJson?: Record<string, unknown>;
  ciEnabled?: boolean;
  tags?: string[];
  [key: string]: unknown;
}
export interface UpdateScenarioParams {
  name?: string | null;
  description?: string | null;
  prompt?: string | null;
  generationMode?: ScenarioGenerationMode;
  twins?: TwinName[] | null;
  seedConfig?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface TrainingDataset {
  id: string;
  name: string;
  traceCount?: number;
  taskCount?: number;
  [key: string]: unknown;
}
export interface TrainingDatasetDetail extends TrainingDataset {
  traces: Array<{ id: string; [key: string]: unknown }>;
  tasks: TrainingTask[];
}
export interface TrainingTask {
  id: string;
  traceId: string;
  revision: number;
  spec: Record<string, unknown>;
  status: "draft" | "approved" | "rejected";
  scenarioId?: string | null;
  graderArtifact?: Record<string, unknown> | null;
  [key: string]: unknown;
}
export interface EvidenceReceipt {
  id: string;
  [key: string]: unknown;
}
export interface GraderArtifact {
  revision: number;
  grader: { source: string; source_hash: string; [key: string]: unknown };
  example: Record<string, unknown>;
}
export interface GraderResult {
  outcome: "pass" | "fail" | "unsafe" | "error";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface CreateUrlRunParams {
  url: string;
  prompt?: string;
  twins?: TwinName[];
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
  twins?: TwinName[];
  frontendUrl?: string;
  sessionId?: string;
}

export interface CreateAgentRunParams {
  repo: string;
  branch?: string;
  prUrl?: string;
  contextNotes?: string;
  scenarioPrompt?: string;
  twins?: TwinName[];
  frontendUrl?: string;
  sessionId?: string;
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
  twins?: TwinName[];
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

export type KnownTwinName =
  | "box"
  | "discord"
  | "dropbox"
  | "github"
  | "gitlab"
  | "gmail"
  | "google_calendar"
  | "google_drive"
  | "hubspot"
  | "jira"
  | "linear"
  | "linkedin"
  | "notion"
  | "postgres"
  | "salesforce"
  | "slack"
  | "stripe"
  | "unified"
  | "unstructured"
  | "waterfall";

export type TwinName = KnownTwinName | (string & {});

export interface Twin {
  name: TwinName;
  label: string;
  kind: string;
  showInUi: boolean;
  mcp?: TwinMcpInfo | null;
}

export interface TwinMcpInfo {
  serverName: string;
  transport: string;
  path: string;
  url?: string | null;
  auth: string;
  notes?: string | null;
}

/** Fast favors speed; thorough handles complex requirements with a longer wait. */
export type ScenarioGenerationMode = "fast" | "thorough";

export interface ProvisionTwinsParams {
  twins: TwinName[];
  ttlMinutes?: number;
  scenarioId?: string;
  /** Generate seed data from this prompt when scenarioId is absent. */
  scenarioPrompt?: string;
  /** Defaults to fast. Only affects scenarioPrompt; saved scenarios reuse their seed data. */
  scenarioGenerationMode?: ScenarioGenerationMode;
  /**
   * Whether the provisioned twins should be reachable via their public
   * `pub-r<id>--<surface>` hosts without proxy auth, so the returned
   * `baseUrl` can be dropped directly into a twin-native SDK (Slack,
   * Stripe, Salesforce, Discord, etc.). Defaults to `true` server-side —
   * pass `false` explicitly if you want to gate the environment behind the
   * proxy token.
   */
  public?: boolean;
}

export interface ProvisionTwinsResponse {
  runId: string;
}

export interface TwinInstance {
  name: TwinName;
  label: string;
  baseUrl: string;
  adminUrl: string;
  envVars: Record<string, string>;
  showInUi: boolean;
  mcpUrl?: string | null;
  mcp?: TwinMcpInfo | null;
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
  failureDetail?: string | null;
}

export interface ExtendTwinsParams {
  ttlMinutes?: number;
}

export interface ExtendTwinsResponse {
  status: string;
  ttlMinutes: number;
}

/** Response from POST /validate/twins/provision/{run_id}/reset */
export interface ResetTwinsResponse {
  runId: string;
  status: string;
  baselineKind?: string;
  factoryReset: Record<string, unknown>;
  seedResults: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface CreateScenarioParams {
  name: string;
  prompt?: string;
  /** Defaults to fast. Only affects prompt generation; explicit seedConfig is used unchanged. */
  generationMode?: ScenarioGenerationMode;
  seedConfig?: Record<string, unknown>;
  twins?: TwinName[];
  description?: string;
  tags?: string[];
  scope?: "personal" | "workspace";
}

export interface ListScenariosParams {
  twin?: string;
  tag?: string;
  scope?: "personal" | "workspace";
  includePresets?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  twins?: TwinName[];
  seedConfig?: Record<string, unknown>;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  scope?: "personal" | "workspace";
  canEdit?: boolean;
  canDelete?: boolean;
  canClone?: boolean;
  canCreateEnvironment?: boolean;
}

export interface EnsureScenarioTwinEnvironmentParams {
  twins?: TwinName[];
  public?: boolean;
}

export interface ScenarioTwinEnvironment {
  id: string;
  scenarioId: string;
  status: string;
  requestedTwins: TwinName[];
  twins: Record<string, TwinInstance>;
  runId?: string;
  dashboardUrl?: string;
  proxyToken?: string;
  public: boolean;
  error?: string;
  seedResults?: Record<string, unknown>;
  lastSeededAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
