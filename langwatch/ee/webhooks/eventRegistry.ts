// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The webhook event catalog: every event type the platform can deliver,
 * grouped by family. The settings UI renders its subscription checkboxes
 * from this registry, endpoint `enabledEvents` values are validated against
 * it, and the delivery scan matches subscriptions with {@link eventMatches}.
 *
 * Envelope shape for every family: `{id, type, created, schema_version,
 * data}` where `id` is the source idempotency id (the gateway request id
 * for spend events), so consumers dedup the same way regardless of family.
 *
 * A registry entry with `isEmitting: false` is a declared contract whose
 * producer has not landed yet: selectable, documented, delivering nothing
 * until its emitter ships. New families (trace, evaluation, simulation,
 * guardrail) slot in as entries here plus a producer; the envelope and
 * delivery machinery do not change.
 */

export interface WebhookEventType {
  /** Dotted type, `<family>.<rest>`, e.g. "gateway.request.completed". */
  type: string;
  /** First dotted segment, the checkbox grouping in the UI. */
  family: string;
  schemaVersion: "1";
  /** False while the producer for this type has not landed. */
  isEmitting: boolean;
  description: string;
}

export const WEBHOOK_EVENT_TYPES = [
  {
    type: "gateway.request.completed",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "One event per gateway request with token classes, rated cost, attribution, and status. The billing feed.",
  },
  {
    type: "gateway.request.settled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "An admitted request whose confirmation never arrived, settled with unknown cost and flagged for reconciliation. A later gateway.request.completed for the same gateway_request_id supersedes it.",
  },
  {
    type: "gateway.budget.threshold_crossed",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: false,
    description:
      "A budget crossed its warn threshold inside the current window.",
  },
  {
    type: "gateway.budget.breached",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: false,
    description: "A budget reached its cap; BLOCK budgets now reject requests.",
  },
  {
    type: "gateway.virtual_key.created",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: false,
    description: "A virtual key was created.",
  },
  {
    type: "gateway.virtual_key.disabled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: false,
    description: "A virtual key was disabled (reversible).",
  },
  {
    type: "gateway.virtual_key.enabled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: false,
    description: "A previously disabled virtual key was re-enabled.",
  },
  {
    type: "gateway.virtual_key.revoked",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: false,
    description: "A virtual key was revoked (terminal).",
  },
] as const satisfies readonly WebhookEventType[];

/** The compile-time union of registered event type names. */
export type WebhookEventTypeName = (typeof WEBHOOK_EVENT_TYPES)[number]["type"];

const KNOWN_TYPES = new Set<string>(WEBHOOK_EVENT_TYPES.map((t) => t.type));
const KNOWN_FAMILIES = new Set<string>(WEBHOOK_EVENT_TYPES.map((t) => t.family));

/**
 * Is `selector` a valid `enabledEvents` value: an exact registry type, a
 * family wildcard ("gateway.*"), or the match-all "*".
 */
export function isValidEventSelector(selector: string): boolean {
  if (selector === "*") return true;
  if (selector.endsWith(".*")) return KNOWN_FAMILIES.has(selector.slice(0, -2));
  return KNOWN_TYPES.has(selector);
}

/**
 * Does an endpoint subscribed to `enabledEvents` receive `eventType`?
 * Exact match, family wildcard, or "*". An empty subscription receives
 * nothing: subscribing is an explicit act, exactly like Stripe.
 */
export function eventMatches(
  enabledEvents: readonly string[],
  eventType: string,
): boolean {
  const family = eventType.split(".")[0] ?? "";
  return enabledEvents.some(
    (selector) =>
      selector === "*" ||
      selector === eventType ||
      (selector.endsWith(".*") && selector.slice(0, -2) === family),
  );
}
