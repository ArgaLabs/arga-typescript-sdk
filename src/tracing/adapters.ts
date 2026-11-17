import type { Tracing } from "./collector.js";
import type { Operation, Provider, Resource, Verb } from "./models.js";
import { value } from "./projection.js";

const STRIPE_RESOURCES = new Set([
  "customers",
  "payment_intents",
  "charges",
  "refunds",
]);
const STRIPE_VERBS = new Set([
  "retrieve",
  "list",
  "search",
  "create",
  "update",
  "delete",
]);
const GMAIL_VERBS = new Set([
  "get",
  "list",
  "create",
  "update",
  "delete",
  "send",
  "modify",
  "trash",
  "untrash",
]);
export function operationFor(path: string): Operation | undefined {
  const [provider, resource, verb, ...rest] = path.split(".");
  if (rest.length) return;
  if (
    (provider === "stripe" &&
      STRIPE_RESOURCES.has(resource) &&
      STRIPE_VERBS.has(verb)) ||
    (provider === "gmail" &&
      ((["messages", "drafts"].includes(resource) && GMAIL_VERBS.has(verb)) ||
        (resource === "profile" && verb === "get")))
  ) {
    return [provider as Provider, resource as Resource, verb as Verb];
  }
}
function parameters(
  provider: Provider,
  args: unknown[],
): Record<string, unknown> {
  const first = args[0],
    raw = provider === "stripe" && typeof first === "string" ? args[1] : first;
  const selected: Record<string, unknown> = {};
  // Only scalar operation facts. Never traverse options, headers, credentials or request bodies.
  for (const key of [
    "id",
    "customer",
    "payment_intent",
    "charge",
    "userId",
    "amount",
    "currency",
  ]) {
    const item = value(raw, key);
    if (["string", "number"].includes(typeof item)) selected[key] = item;
  }
  if (provider === "stripe" && typeof first === "string") selected.id = first;
  return selected;
}
export function wrapProvider<T extends object>(
  target: T,
  tracing: Tracing,
  provider: Provider,
  path: string[] = [],
): T {
  // Google defines resource namespaces as frozen own properties. A proxy on the
  // original cannot substitute their wrappers without violating JS invariants.
  // Use a facade with the original prototype and bind every method to the real client.
  return new Proxy(Object.create(Object.getPrototypeOf(target)) as T, {
    has(_shadow, property) {
      return property in target;
    },
    ownKeys() {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_shadow, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    set(_shadow, property, item) {
      return Reflect.set(target, property, item, target);
    },
    get(_shadow, property) {
      const object = target;
      const member = Reflect.get(object, property, object);
      if (typeof property !== "string" || property.startsWith("_"))
        return typeof member === "function" ? member.bind(object) : member;
      const next = [...path, property];
      if (member && typeof member === "object") {
        // Provider resource namespaces only. Do not wrap auth/configuration/transport objects.
        const config = new Set(["context", "auth", "errors", "webhooks"]);
        return config.has(property)
          ? member
          : wrapProvider(member, tracing, provider, next);
      }
      if (typeof member !== "function") return member;
      const canonical =
        provider === "stripe"
          ? `stripe.${next
              .filter((part) => part !== "v1")
              .map((part) =>
                part === "paymentIntents"
                  ? "payment_intents"
                  : part === "del"
                    ? "delete"
                    : part,
              )
              .join(".")}`
          : next.join(".") === "users.getProfile"
            ? "gmail.profile.get"
            : `gmail.${next.filter((part) => part !== "users").join(".")}`;
      const operation = operationFor(canonical);
      return (...args: unknown[]) => {
        const current = tracing.start(operation);
        let facts: Record<string, unknown> = {};
        try {
          facts = parameters(provider, args);
        } catch {
          current?.projector.issue("projection_failed");
        }
        let finished = false;
        const end = (result?: unknown, error?: unknown) => {
          if (finished) return;
          finished = true;
          // Google clients return GaxiosResponse; Stripe resolves the resource itself.
          try {
            tracing.end(
              current,
              operation,
              facts,
              provider === "gmail" ? value(result, "data") : result,
              error,
            );
          } catch {
            current?.projector.issue("projection_failed");
          }
        };
        const callbackIndex = args.length - 1;
        if (typeof args[callbackIndex] === "function") {
          const callback = args[callbackIndex] as (
            ...params: unknown[]
          ) => unknown;
          args[callbackIndex] = function (this: unknown, ...params: unknown[]) {
            end(params[1], params[0]);
            return callback.apply(this, params);
          };
        }
        try {
          const result = member.apply(object, args);
          if (result && typeof result.then === "function") {
            // Observe, do not replace provider responses or errors. Catch observer failures locally.
            void result.then(
              (output: unknown) => end(output),
              (error: unknown) => end(undefined, error),
            );
            if (
              provider === "stripe" &&
              (result.autoPagingEach || result.autoPagingToArray)
            ) {
              return new Proxy(result, {
                get(p, key) {
                  const item = Reflect.get(p, key, p);
                  if (
                    key === "autoPagingEach" ||
                    key === "autoPagingToArray" ||
                    key === Symbol.asyncIterator
                  ) {
                    return (...pageArgs: unknown[]) => {
                      current?.projector.issue("source_incomplete");
                      return item.apply(p, pageArgs);
                    };
                  }
                  return typeof item === "function" ? item.bind(p) : item;
                },
              });
            }
          } else if (typeof args[callbackIndex] !== "function") end(result);
          return result;
        } catch (error) {
          end(undefined, error);
          throw error;
        }
      };
    },
  });
}
