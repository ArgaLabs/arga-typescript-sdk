import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import schema from "./evidence.schema.json" with { type: "json" };

export const MAX_EVIDENCE_BYTES = 100_000;
export type Resource =
  | "customers"
  | "payment_intents"
  | "charges"
  | "refunds"
  | "messages"
  | "drafts"
  | "profile";
export type Verb =
  | "retrieve"
  | "get"
  | "list"
  | "search"
  | "create"
  | "update"
  | "send"
  | "modify"
  | "trash"
  | "untrash"
  | "delete";
export type Issue =
  | "unsupported_operation"
  | "projection_failed"
  | "record_limit"
  | "event_limit"
  | "payload_limit"
  | "source_incomplete"
  | "text_dropped"
  | "agent_error";
export type Provider = "gmail" | "stripe";
export type Operation = readonly [Provider, Resource, Verb];
export const SUPPORTED_OPERATIONS = new Set([
  ...["retrieve", "list", "search", "create", "update", "delete"].map(
    (verb) => `stripe.customers.${verb}`,
  ),
  ...["payment_intents", "charges"].flatMap((resource) =>
    ["retrieve", "list", "search", "create", "update"].map(
      (verb) => `stripe.${resource}.${verb}`,
    ),
  ),
  ...["retrieve", "list", "create", "update"].map(
    (verb) => `stripe.refunds.${verb}`,
  ),
  ...[
    "get",
    "list",
    "create",
    "send",
    "modify",
    "trash",
    "untrash",
    "delete",
  ].map((verb) => `gmail.messages.${verb}`),
  ...["get", "list", "create", "update", "send", "delete"].map(
    (verb) => `gmail.drafts.${verb}`,
  ),
  "gmail.profile.get",
]);
export function scopeFor(verb: Verb): EvidenceEvent["scope"] {
  return ["list", "search"].includes(verb)
    ? "result_page"
    : ["get", "retrieve"].includes(verb)
      ? "resource"
      : "mutation";
}
export interface EvidenceParameters {
  id?: string;
  customer?: string;
  payment_intent?: string;
  charge?: string;
  user?: string;
  amount?: number;
  currency?: string;
}
export interface EvidenceRecord {
  resource: Resource;
  id: string;
  customer?: string;
  payment_intent?: string;
  charge?: string;
  latest_charge?: string;
  thread_id?: string;
  message_id?: string;
  email?: string;
  from?: string;
  to?: string[];
  subject?: string;
  body?: string;
  labels?: string[];
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  paid?: boolean;
  captured?: boolean;
  refunded?: boolean;
  status?: string;
  created?: number;
  internal_date?: number;
}
export interface EvidenceError {
  category: "provider" | "permission" | "rate_limit" | "network" | "unknown";
  http_status?: number;
  code?:
    | "rate_limit"
    | "resource_missing"
    | "permission_denied"
    | "invalid_request"
    | "insufficient_funds"
    | "other";
}
export interface EvidenceEvent {
  sequence: number;
  provider: Provider;
  resource: Resource;
  verb: Verb;
  parameters: EvidenceParameters;
  records: EvidenceRecord[];
  scope: "resource" | "result_page" | "mutation";
  complete?: boolean;
  error?: EvidenceError;
}
/** Wire-format fields intentionally use snake_case, matching Python and the backend. */
export interface Episode {
  schema_version: "arga.evidence.v1";
  source: string;
  origin: "sdk" | "braintrust";
  episode_id: string;
  policy_hash: string;
  goal?: string;
  policies: string[];
  events: EvidenceEvent[];
  issues: Issue[];
}
export const evidenceSchema = schema;
let validate: ValidateFunction | undefined,
  recordValidator: ValidateFunction | undefined;
function validators(): void {
  if (validate) return;
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  validate = ajv.compile(schema);
  recordValidator = ajv.compile({
    $ref: "#/$defs/Record",
    $defs: schema.$defs,
  });
}
export function validateRecord(
  record: unknown,
): asserts record is EvidenceRecord {
  validators();
  if (!recordValidator!(record)) throw new Error("Invalid projected record");
}
export function validateEpisode(episode: unknown): Episode {
  validators();
  if (!validate!(episode)) throw new Error("Invalid evidence contract");
  // Detach prototype hooks such as non-enumerable toJSON before serialization.
  // Revalidate so getters cannot change fields after validation.
  const detached = structuredClone(episode) as Record<string, unknown>;
  const value = {
    schema_version: "arga.evidence.v1",
    origin: "sdk",
    policies: [],
    events: [],
    issues: [],
    ...detached,
  } as unknown as Episode;
  value.schema_version ??= "arga.evidence.v1";
  value.origin ??= "sdk";
  value.policies ??= [];
  value.events ??= [];
  value.issues ??= [];
  value.events = value.events.map((event) => ({
    ...event,
    parameters: event.parameters ?? {},
    records: event.records ?? [],
  }));
  if (!validate!(value)) throw new Error("Invalid evidence contract");
  if (value.events.some((event, i) => event.sequence !== i + 1))
    throw new Error("Events must have contiguous sequence numbers");
  for (const event of value.events) {
    const scope = scopeFor(event.verb);
    if (
      !SUPPORTED_OPERATIONS.has(
        `${event.provider}.${event.resource}.${event.verb}`,
      ) ||
      event.scope !== scope
    )
      throw new Error("Unsupported evidence operation or scope");
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_EVIDENCE_BYTES)
    throw new Error("Evidence exceeds the upload limit");
  return value;
}
export function blockers(episode: Episode): string[] {
  const reasons: string[] = episode.issues.filter(
    (issue) => issue !== "agent_error" && issue !== "text_dropped",
  );
  if (!episode.goal) reasons.push("missing_goal");
  if (
    !episode.events.some(
      (event) => event.scope !== "mutation" && event.records.length,
    )
  )
    reasons.push("missing_starting_state");
  return reasons;
}
