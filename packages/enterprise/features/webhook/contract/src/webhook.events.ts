import { z } from "zod";

export const webhookEventTypeSchema = z.object({
  type: z.string().min(1),
  family: z.string().min(1),
  schemaVersion: z.literal("1"),
  isEmitting: z.boolean(),
  description: z.string().min(1),
});
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
      "An admitted request settled with unknown cost and flagged for reconciliation.",
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
    description: "A budget reached its cap.",
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
    description: "A virtual key secret was rotated.",
  },
  {
    type: "gateway.virtual_key.disabled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A virtual key was disabled.",
  },
  {
    type: "gateway.virtual_key.enabled",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A virtual key was enabled.",
  },
  {
    type: "gateway.virtual_key.revoked",
    family: "gateway",
    schemaVersion: "1",
    isEmitting: true,
    description: "A virtual key was revoked.",
  },
] as const satisfies readonly WebhookEventType[];

export type WebhookEventTypeName = (typeof WEBHOOK_EVENT_TYPES)[number]["type"];

const knownTypes = new Set<string>(WEBHOOK_EVENT_TYPES.map((entry) => entry.type));
const knownFamilies = new Set<string>(WEBHOOK_EVENT_TYPES.map((entry) => entry.family));

export function isValidEventSelector(selector: string): boolean {
  if (selector === "*") return true;
  if (selector.endsWith(".*")) return knownFamilies.has(selector.slice(0, -2));
  return knownTypes.has(selector);
}

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
