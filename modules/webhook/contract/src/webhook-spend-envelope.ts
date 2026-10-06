import { gatewaySpendEventSchema } from "@langwatch/gateway-contract";
/**
 * One spend row rendered as the canonical billing envelope every webhook
 * destination receives. Pure formatting over a row shape, so a peer building
 * the SAME envelope for its own spend rows needs only this function.
 */
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import type { WebhookEnvelope } from "./webhook.ts";

export type WebhookSpendEventStatus = "admitted" | "confirmed" | "failed" | "settled";

export type WebhookSpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  requestType: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  tokensInputImage: number;
  tokensOutputImage: number;
  imageCount: number;
  costNanoUsd: number;
  costUsd: string;
  rateVersion: string;
  status: WebhookSpendEventStatus;
  errorClass: string;
  httpStatus: number;
  needsReconciliation: boolean;
  settleReason: string;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Instant;
};

function envelopeKind(status: WebhookSpendEventStatus): {
  type: string;
  idSuffix: string;
  payloadStatus: string;
} {
  switch (status) {
    case "admitted":
      return {
        type: "gateway.request.admitted",
        idSuffix: "admitted",
        payloadStatus: "admitted",
      };
    case "settled":
      return {
        type: "gateway.request.settled",
        idSuffix: "settled",
        payloadStatus: "settled",
      };
    case "failed":
      return {
        type: "gateway.request.completed",
        idSuffix: "completed",
        payloadStatus: "error",
      };
    case "confirmed":
      return {
        type: "gateway.request.completed",
        idSuffix: "completed",
        payloadStatus: "success",
      };
  }
}

function parseMetadata(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** One spend row as the canonical billing envelope every destination receives. */
export function webhookEnvelopeFromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope {
  const { type, idSuffix, payloadStatus } = envelopeKind(row.status);
  const settled = row.status === "settled";
  const unknownQuantities = settled || row.status === "admitted";
  const eventId = `${row.gatewayRequestId}:${idSuffix}`;

  return {
    id: eventId,
    type,
    created: row.occurredAt.toString({ fractionalSecondDigits: 3 }),
    schema_version: "1",
    data: {
      event_id: eventId,
      event_type: type,
      gateway_request_id: row.gatewayRequestId,
      occurred_at: row.occurredAt.toString({ fractionalSecondDigits: 3 }),
      organization_id: row.organizationId,
      project_id: row.tenantId,
      virtual_key_id: row.virtualKeyId,
      principal_user_id: row.principalUserId || null,
      end_user_id: row.endUserId || null,
      trace_id: row.traceId,
      model: row.model || null,
      model_provider_id: row.providerKey || null,
      request_type: row.requestType || null,
      usage: unknownQuantities
        ? null
        : {
            input_tokens: row.tokensInput,
            output_tokens: row.tokensOutput,
            cache_read_input_tokens: row.tokensCacheRead,
            cache_creation_input_tokens: row.tokensCacheWrite,
            reasoning_tokens: row.tokensReasoning,
            input_image_tokens: row.tokensInputImage,
            output_image_tokens: row.tokensOutputImage,
            image_count: row.imageCount,
          },
      cost: unknownQuantities
        ? null
        : {
            total_usd: row.costUsd,
            nano_usd: row.costNanoUsd,
            rate_version: row.rateVersion || null,
          },
      status: payloadStatus,
      needs_reconciliation: settled ? true : null,
      settle_reason: settled ? row.settleReason || null : null,
      error: row.errorClass ? { class: row.errorClass, http_status: row.httpStatus || null } : null,
      duration_ms: unknownQuantities ? null : row.durationMs,
      labels: row.labels,
      metadata: parseMetadata(row.metadata),
    },
  };
}

/**
 * The gateway spend events webhook delivery consumes, as the delivery
 * pipeline's one command carries them: webhook's peer subscribers read these
 * off gateway_spend_processing (the schemas are gateway's contract events).
 */

export const WEBHOOK_DELIVERY_PIPELINE_NAME = "webhook_delivery" as const;
export const WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE = "webhook_spend_delivery" as const;
export const WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE =
  "lw.webhook.spend_delivery.requested" as const;
export const WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_VERSION = "2026-09-25" as const;
export const REQUEST_SPEND_DELIVERY_COMMAND_TYPE = "lw.webhook.request_spend_delivery" as const;

/** One committed gateway spend event as webhook delivery takes it, named by its event id. */
export const webhookSpendDeliveryRequestSchema = z.object({
  sourceEventId: z.string().min(1),
  spend: gatewaySpendEventSchema,
});
export type WebhookSpendDeliveryRequest = z.infer<typeof webhookSpendDeliveryRequestSchema>;
