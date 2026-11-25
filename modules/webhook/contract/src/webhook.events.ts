import type { Named } from "@langwatch/module";
import { z } from "zod";

const webhookEventTypeSchemaDefinition = z.object({
  type: z.string().min(1),
  family: z.string().min(1),
  schemaVersion: z.literal("1"),
  isEmitting: z.boolean(),
  /** Left out of `*`: an endpoint receives the type only when it names it or its family. */
  isOptInOnly: z.boolean().optional(),
  description: z.string().min(1),
});
export interface WebhookEventTypeSchema extends Named<typeof webhookEventTypeSchemaDefinition> {}
export const webhookEventTypeSchema: WebhookEventTypeSchema = webhookEventTypeSchemaDefinition;
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

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
    isEmitting: true,
    description: "A budget crossed its warn threshold inside the current window.",
  },
  {
    type: "gateway.budget.breached",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A budget reached its cap; BLOCK budgets now reject requests.",
  },
  {
    type: "gateway.virtual_key.created",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A virtual key was created.",
  },
  {
    type: "gateway.virtual_key.rotated",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "A virtual key's secret was rotated; the previous secret stays valid for its grace window.",
  },
  {
    type: "gateway.virtual_key.disabled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A virtual key was disabled (reversible).",
  },
  {
    type: "gateway.virtual_key.enabled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A previously disabled virtual key was re-enabled.",
  },
  {
    type: "gateway.virtual_key.revoked",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A virtual key was revoked (terminal).",
  },
  {
    type: "governance.anomaly_alert.triggered",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description: "A governance anomaly rule fired an alert for an endpoint its destination names.",
  },
  {
    type: "governance.agent.registered",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description: "An agent entered the organisation's agent registry at version 1.",
  },
  {
    type: "governance.agent.versioned",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "A registry agent's endpoints, model configuration, instructions, tools or status changed; carries from_version and to_version.",
  },
  {
    type: "governance.agent.removed",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description: "A registry agent is no longer defined at its source.",
  },
  {
    type: "governance.agent.tool_deprecated",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description: "A tool left a registry agent's latest version; it stays listed as deprecated.",
  },
  {
    type: "governance.agent.flagged_shadow",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "An agent seen in the organisation's traffic matches no listed source and is flagged as shadow.",
  },
  {
    type: "governance.agent.stop_requested",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "A stop of a registry agent was requested and waits for an approval; carries the stop with its targets.",
  },
  {
    type: "governance.agent.quarantined",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "Every target of an agent's stop plan was applied, so the agent is quarantined; carries each target's outcome.",
  },
  {
    type: "governance.agent.stop_failed",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "A stop settled with at least one target the platform refused; carries each target's outcome and error code.",
  },
  {
    type: "governance.agent.restored",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "Every target the stop changed was reverted; a target that was already stopped before the stop stays stopped.",
  },
  {
    type: "governance.agent.restore_failed",
    family: "governance",
    schemaVersion: "1",
    isEmitting: true,
    description:
      "A restore settled with at least one target the platform would not revert; carries each target's outcome.",
  },
  {
    type: "ocsf.event",
    family: "ocsf",
    schemaVersion: "1",
    isEmitting: true,
    isOptInOnly: true,
    description:
      "One OCSF 1.9.0 governance event for a SIEM, batched per delivery like every event type. Sent only to endpoints that name this type or ocsf.*, never to *.",
  },
] as const satisfies readonly WebhookEventType[];

export type WebhookEventTypeName = (typeof WEBHOOK_EVENT_TYPES)[number]["type"];

const knownTypes = new Set<string>(WEBHOOK_EVENT_TYPES.map((entry) => entry.type));
const knownFamilies = new Set<string>(WEBHOOK_EVENT_TYPES.map((entry) => entry.family));

/**
 * `*`, an exact type, a family (`gateway.*`) or a deeper prefix a known type has
 * (`governance.agent.*`).
 */
export function isValidEventSelector(selector: string): boolean {
  if (selector === "*") return true;
  if (selector.endsWith(".*")) {
    const prefix = selector.slice(0, -1);
    return (
      knownFamilies.has(selector.slice(0, -2)) ||
      [...knownTypes].some((type) => type.startsWith(prefix))
    );
  }
  return knownTypes.has(selector);
}

const optInOnlyTypes = new Set<string>(
  WEBHOOK_EVENT_TYPES.flatMap((entry) =>
    "isOptInOnly" in entry && entry.isOptInOnly ? [entry.type] : [],
  ),
);

/** `*` matches every type except an opt-in-only one, which an endpoint must name to receive. */
export function eventMatches(enabledEvents: readonly string[], eventType: string): boolean {
  const isOptInOnly = optInOnlyTypes.has(eventType);
  return enabledEvents.some(
    (selector) =>
      (selector === "*" && !isOptInOnly) ||
      selector === eventType ||
      (selector.endsWith(".*") && eventType.startsWith(selector.slice(0, -1))),
  );
}
