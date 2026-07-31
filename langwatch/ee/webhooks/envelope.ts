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
 * Map a spend row to its wire envelope, branched on the row's lifecycle
 * status:
 *
 * - `confirmed` / `failed` become `gateway.request.completed` (the money
 *   stream; the payload's `status` distinguishes success from error).
 * - `settled` becomes `gateway.request.settled`: cost and usage are NULL
 *   because unknown is not zero, `needs_reconciliation` is true, and the
 *   settle reason rides along. A settled request NEVER appears in the
 *   completed stream, so billing consumers can trust completed for money.
 *
 * Supersession: a late confirmation after a settlement delivers a real
 * completed envelope for the same `gateway_request_id`. Envelope ids are
 * type-suffixed exactly so no dedup layer collides the pair; consumers
 * reconcile on `gateway_request_id` and REPLACE the settled figure, never
 * sum the two.
 *
 * `admitted` rows are in-flight requests. The delivery process manager
 * never maps them (nothing is emitted until an outcome), but the PULL
 * surface serves the ledger, whose status filter includes them; an
 * admitted row maps to `gateway.request.admitted` with null usage, cost,
 * and duration (unknown YET, which is not zero). That type never appears
 * on the push stream.
 *
 * Naming seam: the ClickHouse column is `ProviderKey` (the budget ledger's
 * audit-column precedent) but the external contract field is
 * `model_provider_id`; the value is the ModelProvider id either way, and
 * the rename happens here and only here. `metadata` is the caller's echo,
 * parsed back to an object when it holds one.
 */
export function spendRowToEnvelope(row: SpendEventRow): WebhookEnvelope {
  const type =
    row.status === "admitted"
      ? "gateway.request.admitted"
      : row.status === "settled"
        ? "gateway.request.settled"
        : "gateway.request.completed";
  const idSuffix =
    row.status === "admitted"
      ? "admitted"
      : row.status === "settled"
        ? "settled"
        : "completed";
  const settled = row.status === "settled";
  // Both in-flight and settled rows have no known quantities or cost.
  const unknownQuantities = settled || row.status === "admitted";
  return {
    id: `${row.gatewayRequestId}:${idSuffix}`,
    type,
    created: row.occurredAt.toISOString(),
    schema_version: "1",
    data: {
      event_id: `${row.gatewayRequestId}:${idSuffix}`,
      event_type: type,
      /** The join key across the settled/completed pair. */
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
      status:
        row.status === "confirmed"
          ? "success"
          : row.status === "failed"
            ? "error"
            : row.status === "admitted"
              ? "admitted"
              : "settled",
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

function parseMetadata(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
