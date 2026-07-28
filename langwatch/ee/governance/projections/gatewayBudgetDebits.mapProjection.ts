// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GatewayBudgetLedgerStatus } from "@prisma/client";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanCostService } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-cost.service";
import { SpanStatusService } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-status.service";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "~/server/event-sourcing/projections/abstractMapProjection";
import type {
  AppendStore,
  MapProjectionOptions,
} from "~/server/event-sourcing/projections/mapProjection.types";

/**
 * Span attribute carrying the virtual key a gateway request was authorised
 * with. Stamped by the gateway's customer trace bridge on every span it emits,
 * and allow-listed into the trace attribute map by
 * `TraceAttributeAccumulationService` — this projection reads it off the span
 * directly, one level earlier.
 */
export const GATEWAY_VIRTUAL_KEY_ID_ATTR = "langwatch.virtual_key_id";

/**
 * Span attribute carrying the gateway's per-request ULID. Half of the ledger's
 * natural key `(TenantId, BudgetId, GatewayRequestId)`.
 */
export const GATEWAY_REQUEST_ID_ATTR = "langwatch.gateway_request_id";

/**
 * One gateway request's spend, derived from the single span the gateway emits
 * for it, before the budgets it applies to are known.
 *
 * This is deliberately NOT the ClickHouse row shape: which budgets a request
 * debits is a Postgres read, and a map projection's `map` is pure. The record
 * carries everything the write side needs so the store's only work is
 * resolution + insert (see `gatewayBudgetDebits.store.ts`).
 */
export interface GatewayBudgetDebitRecord {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Trace the span belongs to. Carried for logging/reconciliation only. */
  traceId: string;
  /** Virtual key the request was authorised with. */
  virtualKeyId: string;
  /** Gateway's per-request ULID — the ledger's idempotency key. */
  gatewayRequestId: string;
  /** Fixed-point USD string for CH's `Decimal`. */
  amountUsd: string;
  tokensInput: number;
  tokensOutput: number;
  /** Resolved model, `"unknown"` when the span names none. */
  model: string;
  status: GatewayBudgetLedgerStatus;
  durationMs: number;
  /**
   * The request's own business time — the span's start. This lands in
   * `OccurredAt`, which is BOTH the ledger's partition key and the input the
   * `gateway_budget_scope_totals` materialised view buckets `PeriodStart`
   * from, so it must be the request's time and never ingest time.
   */
  occurredAt: Date;
}

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

const spanCostService = new SpanCostService();
const spanStatusService = new SpanStatusService();

const spanEvents = [spanReceivedEventSchema] as const;

/**
 * Serialise a JS number to the fixed-point decimal string ClickHouse expects.
 * Carried over verbatim from `gatewayBudgetSync.reactor.ts` so a converted
 * debit is byte-identical to the one the reactor would have written.
 */
export function formatLedgerDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toFixed(10);
}

/**
 * Ledger status for one gateway span.
 *
 * The reactor read `foldState.blockedByGuardrail` for a third branch, but
 * nothing in the pipeline ever sets that flag — no extractor writes a
 * guardrail marker, so `TraceSummaryData.blockedByGuardrail` is `false` from
 * `init()` onwards and `BLOCKED_BY_GUARDRAIL` was unreachable in production.
 * The branch is dropped rather than carried forward as decoration; when a
 * guardrail marker lands, it belongs here.
 */
export function deriveLedgerStatus(
  span: NormalizedSpan,
): GatewayBudgetLedgerStatus {
  return spanStatusService.extractStatus(span).hasError
    ? "PROVIDER_ERROR"
    : "SUCCESS";
}

/**
 * Derive one gateway request's debit facts from an already-normalized span.
 *
 * Exported so the `virtualKeyLastUsed` subscriber recognises a gateway span
 * with exactly the same test this projection applies — the two must never
 * disagree about what counts as gateway traffic.
 */
export function deriveGatewayDebitRecord(
  span: NormalizedSpan,
): GatewayBudgetDebitRecord | null {
  const virtualKeyId = span.spanAttributes[GATEWAY_VIRTUAL_KEY_ID_ATTR];
  const gatewayRequestId = span.spanAttributes[GATEWAY_REQUEST_ID_ATTR];
  if (typeof virtualKeyId !== "string" || virtualKeyId === "") return null;
  if (typeof gatewayRequestId !== "string" || gatewayRequestId === "") {
    return null;
  }

  // Same SpanCostService calls the trace-summary fold and the analytics rollup
  // make, on the same normalized span, so a request's debit equals its
  // contribution to `trace_summaries.TotalCost` to the cent. Re-deriving cost
  // here by hand is how a ledger silently drifts from the traces it claims to
  // mirror.
  const tokens = spanCostService.extractTokenMetrics(span);

  return {
    tenantId: span.tenantId,
    traceId: span.traceId,
    virtualKeyId,
    gatewayRequestId,
    amountUsd: formatLedgerDecimal(tokens.cost),
    tokensInput: tokens.promptTokens,
    tokensOutput: tokens.completionTokens,
    model: spanCostService.extractModelsFromSpan(span)[0] ?? "unknown",
    status: deriveLedgerStatus(span),
    durationMs: Math.round(span.durationMs),
    occurredAt: new Date(span.startTimeUnixMs),
  };
}

/**
 * ADR-075 Class C: gateway spend as derived state, so replay can rebuild it.
 *
 * Replaces `gatewayBudgetSync.reactor.ts`'s ClickHouse half. The reactor's
 * writes sat outside the event-sourced guarantee — the projection router pins
 * `LIVE_DISPATCH_IS_REPLAY = false` and the replay service never invokes a
 * reactor — so a debit lost to a failed handler was lost permanently: the
 * spend happened, the trace recorded it, and the budget never learned. Both of
 * a reactor's failure modes push measured spend DOWN, which is the wrong
 * direction for a control whose job is to stop spending.
 *
 * As a map projection the same derivation runs on the replay path
 * (`replayMapPath.ts`), so a rebuild over a window re-derives every debit the
 * event log can account for and writes back the ones that are missing. That is
 * what `specs/ai-gateway/budgets.feature` § "Spend must survive the thing that
 * recorded it" asks for.
 *
 * **Why a map and not a fold.** The gateway emits ONE span per request
 * carrying that request's complete `gen_ai.usage.*`, its virtual key, and its
 * `gateway_request_id` — the ledger's natural key is per-request, not
 * per-trace. Reading trace-level fold state (as the reactor had to) charges a
 * trace's whole cost to whichever gateway request id happened to win the
 * attribute merge, so a trace carrying two gateway calls debited once and
 * over-charged the first while dropping the second. Per-span derivation is
 * both the honest unit and a fix for that.
 *
 * **Idempotency.** `gateway_budget_ledger_events` is a
 * `ReplacingMergeTree(EventTimestamp)` with
 * `ORDER BY (TenantId, BudgetId, GatewayRequestId)`, and the write path probes
 * for an existing row before inserting — the rollup materialised view
 * aggregates at INSERT time and does not collapse, so the probe, not the
 * merge, is what stops a replay double-counting. `dedupeByIdempotencyKey` is
 * deliberately NOT enabled: it costs an event-log read per span, and the
 * probe already dedups on the stronger key.
 */
export class GatewayBudgetDebitsMapProjection
  extends AbstractMapProjection<GatewayBudgetDebitRecord, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, GatewayBudgetDebitRecord>
{
  readonly name = "gatewayBudgetDebits";
  readonly store: AppendStore<GatewayBudgetDebitRecord>;
  protected readonly events = spanEvents;

  override options: MapProjectionOptions & {
    groupKeyFn: (event: { id: string }) => string;
  } = {
    // Per-span parallelism. Each gateway request's debit is independent of
    // every other — there is no per-trace ordering to preserve — so serialising
    // them behind a trace key would only add latency to a write the gateway is
    // waiting on to re-authorise. Mirrors spanStorage / traceAnalyticsRollup.
    groupKeyFn: (event: { id: string }) => `gateway-budget:${event.id}`,
  };

  constructor(deps: { store: AppendStore<GatewayBudgetDebitRecord> }) {
    super();
    this.store = deps.store;
  }

  mapTraceSpanReceived(
    event: SpanReceivedEvent,
  ): GatewayBudgetDebitRecord | null {
    const span = spanNormalizationPipelineService.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    // Non-gateway spans map to null and never reach the store. This is the
    // overwhelming majority of the span stream, and `null` is the cheapest
    // possible outcome short of never staging the job at all — see the
    // enqueue-filter note in the ADR-075 conversion report.
    return deriveGatewayDebitRecord(span);
  }
}
