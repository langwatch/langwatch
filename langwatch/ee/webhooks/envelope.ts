// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";

/**
 * The versioned envelope every webhook delivery carries, one per
 * real-world occurrence: `id` is the source idempotency id (stable across
 * retries AND replays, the consumer's dedup key), `created` is when the
 * event occurred (never when it was delivered), `data` is the typed,
 * business-cut payload for the event type.
 */
export interface WebhookEnvelope {
  id: string;
  type: string;
  /** ISO-8601 instant the event occurred. */
  created: string;
  schema_version: "1";
  data: Record<string, unknown>;
}

/**
 * Map a spend row to its `gateway.request.completed` envelope.
 *
 * Naming seam: the ClickHouse column is `ProviderKey` (the budget ledger's
 * audit-column precedent) but the external contract field is
 * `model_provider_id`; the value is the ModelProvider id either way, and
 * the rename happens here and only here. `metadata` is the caller's echo,
 * parsed back to an object when it holds one.
 */
export function spendRowToEnvelope(row: SpendEventRow): WebhookEnvelope {
  return {
    id: row.gatewayRequestId,
    type: "gateway.request.completed",
    created: row.occurredAt.toISOString(),
    schema_version: "1",
    data: {
      event_id: row.gatewayRequestId,
      event_type: "gateway.request.completed",
      occurred_at: row.occurredAt.toISOString(),
      organization_id: row.organizationId,
      project_id: row.tenantId,
      virtual_key_id: row.virtualKeyId,
      principal_user_id: row.principalUserId || null,
      end_user_id: row.endUserId || null,
      trace_id: row.traceId,
      model: row.model,
      model_provider_id: row.providerKey || null,
      request_type: row.requestType || null,
      usage: {
        input_tokens: row.tokensInput,
        output_tokens: row.tokensOutput,
        cache_read_input_tokens: row.tokensCacheRead,
        cache_creation_input_tokens: row.tokensCacheWrite,
        reasoning_tokens: row.tokensReasoning,
      },
      cost: {
        total_usd: row.costUsd,
        nano_usd: row.costNanoUsd,
        rate_version: row.rateVersion || null,
      },
      status:
        row.status === "confirmed"
          ? "success"
          : row.status === "failed"
            ? "error"
            : row.status,
      needs_reconciliation: row.needsReconciliation ? true : null,
      error: row.errorClass
        ? { class: row.errorClass, http_status: row.httpStatus || null }
        : null,
      duration_ms: row.durationMs,
      labels: row.labels,
      metadata: parseMetadata(row.metadata),
    },
  };
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
