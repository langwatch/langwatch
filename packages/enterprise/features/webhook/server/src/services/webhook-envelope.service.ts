import type { WebhookEnvelope } from "@langwatch/enterprise-webhook-contract";

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
  occurredAt: Date;
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
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class WebhookEnvelopeService {
  private constructor() {}

  static create(): WebhookEnvelopeService {
    return new WebhookEnvelopeService();
  }

  static fromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope {
    const { type, idSuffix, payloadStatus } = envelopeKind(row.status);
    const settled = row.status === "settled";
    const unknownQuantities = settled || row.status === "admitted";
    const eventId = `${row.gatewayRequestId}:${idSuffix}`;
    return {
      id: eventId,
      type,
      created: row.occurredAt.toISOString(),
      schema_version: "1",
      data: {
        event_id: eventId,
        event_type: type,
        gateway_request_id: row.gatewayRequestId,
        occurred_at: row.occurredAt.toISOString(),
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
        error: row.errorClass
          ? { class: row.errorClass, http_status: row.httpStatus || null }
          : null,
        duration_ms: unknownQuantities ? null : row.durationMs,
        labels: row.labels,
        metadata: parseMetadata(row.metadata),
      },
    };
  }

  fromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope {
    return WebhookEnvelopeService.fromSpendRow(row);
  }
}
