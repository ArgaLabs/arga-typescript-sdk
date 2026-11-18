import { replaceEmails, extractEmails } from "./strings.js";
import { createHash, createHmac } from "node:crypto";
import {
  MAX_EVIDENCE_BYTES,
  validateRecord,
  validateEpisode,
  type Episode,
  type Issue,
  type Operation,
  type Resource,
  type EvidenceRecord,
  type EvidenceError,
  type EvidenceParameters,
  type EvidenceEvent,
} from "./models.js";

export const READS = new Set(["get", "retrieve", "list", "search"]);
const TEXT_FIELDS = new Set(["goal", "policy", "gmail.subject", "gmail.body"]);
const PREFIXES: Record<Resource, string> = {
  customers: "cus",
  payment_intents: "pi",
  charges: "ch",
  refunds: "re",
  messages: "msg",
  drafts: "draft",
  profile: "actor",
};
const FIELDS: Record<string, string[]> = {
  customers: ["email"],
  payment_intents: [
    "customer",
    "latest_charge",
    "amount",
    "currency",
    "status",
    "created",
  ],
  charges: [
    "customer",
    "payment_intent",
    "amount",
    "amount_refunded",
    "currency",
    "paid",
    "captured",
    "refunded",
    "status",
    "created",
  ],
  refunds: [
    "payment_intent",
    "charge",
    "amount",
    "currency",
    "status",
    "created",
  ],
};
const SYSTEM_LABELS = new Set([
  "INBOX",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "CHAT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);
const RESOURCE_ID = /\b(cus|pi|ch|re)_[A-Za-z0-9_]+\b/g;
const SECRET =
  /(?:Bearer\s+\S+|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|\barga_[A-Za-z0-9_.-]{20,}|ya29\.[A-Za-z0-9._-]+|["']?(?:password|api[_-]?key|access[_-]?token|secret)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+))/gi;
export function value(
  object: unknown,
  key: string,
  fallback?: unknown,
): unknown {
  return object !== null && typeof object === "object" && !Array.isArray(object)
    ? ((object as Record<string, unknown>)[key] ?? fallback)
    : fallback;
}
export function stableJson(obj: unknown): string {
  if (Array.isArray(obj)) return `[${obj.map(stableJson).join(",")}]`;
  if (obj !== null && typeof obj === "object")
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((obj as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(obj);
}
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
export interface CapturePolicyOptions {
  textFields?: readonly string[];
  transformText?: (text: string) => string;
  revision?: string;
}
export class CapturePolicy {
  readonly textFields: readonly string[];
  readonly transformText?: (text: string) => string;
  readonly revision: string;
  constructor(options: CapturePolicyOptions = {}) {
    this.textFields = Object.freeze(
      [...new Set(options.textFields ?? [])].sort(),
    );
    this.transformText = options.transformText;
    this.revision = options.revision ?? "1";
    if (
      this.textFields.some((field) => !TEXT_FIELDS.has(field)) ||
      typeof this.revision !== "string" ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(this.revision)
    )
      throw new Error("Invalid local capture policy");
    if (
      this.transformText !== undefined &&
      typeof this.transformText !== "function"
    )
      throw new Error("Invalid local text filter");
    Object.freeze(this);
  }
  get fingerprint(): string {
    return sha256(
      stableJson({
        text_fields: this.textFields,
        revision: this.revision,
        custom_filter: !!this.transformText,
      }),
    );
  }
}
export class Projector {
  readonly episode: Episode;
  private readonly key: Buffer;
  constructor(
    readonly options: {
      source: string;
      episodeKey: string;
      aliasKey: Uint8Array;
      policy: CapturePolicy;
      origin?: "sdk" | "braintrust";
    },
  ) {
    if (
      options.aliasKey.length < 32 ||
      typeof options.source !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(options.source)
    )
      throw new Error("Invalid local projection configuration");
    this.key = createHmac("sha256", options.aliasKey)
      .update(options.episodeKey)
      .digest();
    this.episode = {
      schema_version: "arga.evidence.v1",
      source: options.source,
      origin: options.origin ?? "sdk",
      episode_id: createHmac("sha256", this.key)
        .update("episode-id")
        .digest("hex")
        .slice(0, 32),
      policy_hash: options.policy.fingerprint,
      policies: [],
      events: [],
      issues: [],
    };
  }
  issue(reason: Issue): void {
    if (!this.episode.issues.includes(reason)) this.episode.issues.push(reason);
  }
  alias(prefix: string, original: unknown): string | undefined {
    return typeof original === "string" && original
      ? `${prefix}_${createHmac("sha256", this.key).update(`${prefix}:${original}`).digest("hex").slice(0, 24)}`
      : undefined;
  }
  email(original: unknown): string | undefined {
    const normalized =
      typeof original === "string" ? original.trim().toLowerCase() : "";
    return normalized
      ? `${this.alias("person", normalized)}@example.invalid`
      : undefined;
  }
  text(name: string, original: unknown): string | undefined {
    if (typeof original !== "string" || !original) return;
    if (!this.options.policy.textFields.includes(name)) {
      this.issue("text_dropped");
      return;
    }
    if (original.length > 64000 || [...original].length > 32000) {
      this.issue("payload_limit");
      return;
    }
    const result = this.options.policy.transformText
      ? this.options.policy.transformText(original)
      : original;
    if (
      typeof result !== "string" ||
      result.length > 8000 ||
      [...result].length > 4000
    ) {
      this.issue("projection_failed");
      return;
    }
    return replaceEmails(
      result.replace(SECRET, "[credential removed]"),
      (email) => this.email(email)!,
    ).replace(RESOURCE_ID, (id, prefix: string) => this.alias(prefix, id)!);
  }
  setGoal(goal: unknown, policies: readonly string[] = []): void {
    try {
      const selected = this.text("goal", goal);
      if (selected !== undefined) this.episode.goal = selected;
      if (policies.length > 10) this.issue("payload_limit");
      this.episode.policies = policies
        .slice(0, 10)
        .map((item) => this.text("policy", item))
        .filter((item): item is string => item !== undefined);
    } catch {
      this.issue("projection_failed");
    }
  }
  parameters(
    [provider, resource]: Operation,
    raw: unknown,
  ): EvidenceParameters {
    const output: Record<string, unknown> = {};
    for (const [key, prefix] of Object.entries({
      id: PREFIXES[resource],
      customer: "cus",
      payment_intent: "pi",
      charge: "ch",
    })) {
      const alias = this.alias(prefix, value(raw, key));
      if (alias) output[key] = alias;
    }
    if (provider === "gmail")
      output.user = this.alias("actor", value(raw, "userId", "me"));
    else {
      const amount = value(raw, "amount"),
        currency = value(raw, "currency");
      if (Number.isSafeInteger(amount)) output.amount = amount;
      if (typeof currency === "string" && /^[a-zA-Z]{3}$/.test(currency))
        output.currency = currency.toLowerCase();
    }
    return output as EvidenceParameters;
  }
  stripeRecord(resource: Resource, raw: unknown): EvidenceRecord {
    const fields: Record<string, unknown> = {
      resource,
      id: this.alias(PREFIXES[resource], value(raw, "id")),
    };
    const refs: Record<string, string> = {
      customer: "cus",
      payment_intent: "pi",
      charge: "ch",
      latest_charge: "ch",
    };
    for (const key of FIELDS[resource]) {
      let item = value(raw, key);
      if (key === "email") item = this.email(item);
      else if (refs[key])
        item = this.alias(
          refs[key],
          typeof item === "object" ? value(item, "id") : item,
        );
      if (item !== undefined && item !== null) fields[key] = item;
    }
    validateRecord(fields);
    return fields;
  }
  gmailRecord(resource: Resource, original: unknown): EvidenceRecord {
    if (resource === "profile") {
      const fields = {
        resource,
        id: this.alias("actor", "me"),
        email: this.email(value(original, "emailAddress")),
      };
      validateRecord(fields);
      return fields;
    }
    const raw =
      resource === "drafts" ? value(original, "message", {}) : original;
    const fields: Record<string, unknown> = {
      resource,
      id: this.alias(PREFIXES[resource], value(original, "id")),
    };
    if (resource === "drafts" && value(raw, "id"))
      fields.message_id = this.alias("msg", value(raw, "id"));
    if (value(raw, "threadId"))
      fields.thread_id = this.alias("thread", value(raw, "threadId"));
    const date = value(raw, "internalDate");
    if (typeof date === "string" && /^\d+$/.test(date))
      fields.internal_date = Number(date);
    const labels = value(raw, "labelIds");
    if (Array.isArray(labels)) {
      if (labels.length > 30) this.issue("record_limit");
      fields.labels = labels
        .slice(0, 30)
        .map((label) =>
          SYSTEM_LABELS.has(label) ? label : this.alias("label", label),
        );
    }
    const payload = value(raw, "payload", {}),
      headers = value(payload, "headers", []);
    if (Array.isArray(headers) && headers.length > 200)
      this.issue("payload_limit");
    for (const header of Array.isArray(headers) ? headers.slice(0, 200) : []) {
      const name = value(header, "name"),
        content = value(header, "value");
      if (typeof name !== "string" || typeof content !== "string") continue;
      if (content.length > 64000) {
        this.issue("payload_limit");
        continue;
      }
      if (name.toLowerCase() === "subject") {
        const text = this.text("gmail.subject", content);
        if (text !== undefined) fields.subject = text;
      } else if (["from", "to"].includes(name.toLowerCase())) {
        const emails = extractEmails(content).map((email) =>
          this.email(email)!,
        );
        if (name.toLowerCase() === "from" && emails.length)
          fields.from = emails[0];
        if (name.toLowerCase() === "to") {
          if (emails.length > 20) this.issue("record_limit");
          fields.to = emails.slice(0, 20);
        }
      }
    }
    if (this.options.policy.textFields.includes("gmail.body")) {
      const parts: unknown[] = [],
        pending: unknown[] = [payload],
        texts: string[] = [];
      while (pending.length && parts.length < 20) {
        const part = pending.shift();
        parts.push(part);
        if (value(part, "filename")) continue;
        const mime = value(part, "mimeType"),
          children = value(part, "parts");
        if (
          typeof mime === "string" &&
          mime.startsWith("multipart/") &&
          Array.isArray(children)
        ) {
          if (children.length + pending.length + parts.length > 20)
            this.issue("payload_limit");
          pending.push(...children.slice(0, Math.max(0, 20 - pending.length)));
        }
      }
      if (pending.length) this.issue("payload_limit");
      for (const part of parts) {
        if (
          value(part, "mimeType") !== "text/plain" ||
          value(part, "filename") ||
          value(value(part, "body"), "attachmentId")
        )
          continue;
        const data = value(value(part, "body", {}), "data");
        if (typeof data !== "string") continue;
        if (data.length > 44000) {
          this.issue("payload_limit");
          continue;
        }
        if (!/^[A-Za-z0-9_\-+/]*={0,2}$/.test(data)) {
          this.issue("projection_failed");
          continue;
        }
        let decoded: string;
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(data, "base64url"),
          );
        } catch {
          this.issue("projection_failed");
          continue;
        }
        const text = this.text("gmail.body", decoded);
        if (text) texts.push(text);
      }
      if (texts.length) {
        const body = texts.join("\n");
        if ([...body].length > 4000) this.issue("payload_limit");
        else fields.body = body;
      }
    }
    validateRecord(fields);
    return fields;
  }
  record(
    operation: Operation,
    args: unknown,
    response?: unknown,
    error?: unknown,
  ): void {
    if (this.episode.events.length >= 100) {
      this.issue("event_limit");
      return;
    }
    try {
      const [provider, resource, verb] = operation,
        read = READS.has(verb);
      const scope = ["list", "search"].includes(verb)
        ? "result_page"
        : read
          ? "resource"
          : "mutation";
      let items: unknown[] = [],
        complete: boolean | undefined;
      if (response !== undefined && response !== null) {
        if (scope === "result_page") {
          const page = value(
            response,
            provider === "stripe" ? "data" : resource,
            [],
          );
          if (!Array.isArray(page)) throw new Error("Invalid provider page");
          items = page;
          const more = value(response, "has_more");
          complete =
            provider === "stripe"
              ? typeof more === "boolean"
                ? !more
                : undefined
              : !value(response, "nextPageToken");
        } else if (value(response, "id") || resource === "profile") {
          items = [response];
          complete = read ? true : undefined;
        } else if (read && !error) throw new Error("Missing provider resource");
      }
      if (items.length > 50) {
        this.issue("record_limit");
        complete = false;
      }
      const event: EvidenceEvent = {
        sequence: this.episode.events.length + 1,
        provider,
        resource,
        verb,
        parameters: this.parameters(operation, args),
        records: items
          .slice(0, 50)
          .map((item) =>
            provider === "stripe"
              ? this.stripeRecord(resource, item)
              : this.gmailRecord(resource, item),
          ),
        scope,
      };
      if (complete !== undefined) event.complete = complete;
      if (error) event.error = normalizeError(error);
      const candidate = {
        ...this.episode,
        events: [...this.episode.events, event],
      };
      if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_EVIDENCE_BYTES) {
        this.issue("payload_limit");
        return;
      }
      validateEpisode(candidate);
      this.episode.events.push(event);
    } catch {
      this.issue("projection_failed");
    }
  }
}
export function normalizeError(error: unknown): EvidenceError {
  const proposed = value(
    error,
    "http_status",
    value(
      error,
      "statusCode",
      value(value(error, "response"), "status", value(error, "code")),
    ),
  );
  const status =
    typeof proposed === "number" &&
    Number.isInteger(proposed) &&
    proposed >= 400 &&
    proposed <= 599
      ? proposed
      : undefined;
  const code = value(error, "code");
  const allowed = new Set([
    "rate_limit",
    "resource_missing",
    "permission_denied",
    "invalid_request",
    "insufficient_funds",
  ]);
  return {
    category:
      status === 401 || status === 403
        ? "permission"
        : status === 429
          ? "rate_limit"
          : status
            ? "provider"
            : "unknown",
    ...(status ? { http_status: status } : {}),
    code: (typeof code === "string" && allowed.has(code)
      ? code
      : "other") as EvidenceError["code"],
  };
}
