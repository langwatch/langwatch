import type { WebhookSpendEventStatus } from "@langwatch/webhook-contract";

/** The spend statuses each webhook event type is rendered from; all of them absent a filter. */
export function spendStatusesForTypes(types?: string[]): WebhookSpendEventStatus[] {
  if (!types) return ["confirmed", "failed", "settled"];
  return [
    ...new Set(
      types.flatMap((type): WebhookSpendEventStatus[] => {
        if (type === "gateway.request.completed") return ["confirmed", "failed"];
        if (type === "gateway.request.settled") return ["settled"];
        return [];
      }),
    ),
  ];
}

/** The request and statuses an emitted event id names, or null for an id no envelope carries. */
export function parseSpendEventId(
  id: string,
): { gatewayRequestId: string; statuses: WebhookSpendEventStatus[] } | null {
  const separator = id.lastIndexOf(":");
  if (separator <= 0 || separator === id.length - 1) return null;
  const gatewayRequestId = id.slice(0, separator);
  const suffix = id.slice(separator + 1);
  if (suffix === "completed") return { gatewayRequestId, statuses: ["confirmed", "failed"] };
  if (suffix === "settled") return { gatewayRequestId, statuses: ["settled"] };
  return null;
}
