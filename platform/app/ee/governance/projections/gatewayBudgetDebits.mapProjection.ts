// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  spanCostService,
  spanNormalizationPipelineService,
  spanStatusService,
} from "@ee/governance/services/spanDerivation.composition";
import type { GatewayBudgetLedgerStatus } from "@prisma/client";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
} from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/spans";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "~/server/event-sourcing.old/projections/abstractMapProjection";
import type {
  AppendStore,
  MapProjectionOptions,
} from "~/server/event-sourcing.old/projections/mapProjection.types";

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
 * The ModelProvider the gateway actually dispatched to. Absent on gateways
 * that predate the field, in which case only unfiltered budgets accrue:
 * attributing an unknown dispatch to a provider-filtered budget would be a
 * guess, and a guess here silently mis-bills a governance control.
 */
export const GATEWAY_MODEL_PROVIDER_ID_ATTR = "langwatch.model_provider_id";

/**
 * Cheap pre-normalisation gate on the RAW OTLP span: does it carry a gateway
 * virtual-key marker at all?
 *
 * Sibling of `isGovernanceOriginWireSpan` in `governanceSpanFacts.ts`, and for
 * the same reason. Normalisation is not cheap — it opens a tracer
 * span and runs every canonicalisation extractor over the whole attribute
 * set, prompts and completions included — and gateway traffic is a small
 * fraction of the span stream. Every consumer of a gateway span runs this
 * first so a non-gateway span costs one attribute-array scan and nothing
 * more.
 *
 * **Presence, not value.** The gateway stamps this key literally, so presence
 * is a total superset of "is gateway traffic"; the type and emptiness checks
 * that actually decide belong after normalisation, where they can be exact.
 * Deliberately defensive for the same reason the governance gate is: this
 * reads wire data behind a Zod-typed cast, and it is also used as an ADR-069
 * (retired; ground now ADR-098) enqueue filter, a seam with no retry — so a
 * missing/!array `attributes`, a
 * null entry or a non-object entry all read as "not gateway" rather than
 * throwing a job away.
 */
export function spanCarriesGatewayVirtualKeyId(span: unknown): boolean {
  if (typeof span !== "object" || span === null) return false;
  const attributes = (span as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return false;
  return attributes.some(
    (attribute) =>
      typeof attribute === "object" &&
      attribute !== null &&
      (attribute as { key?: unknown }).key === GATEWAY_VIRTUAL_KEY_ID_ATTR,
  );
}

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
  /**
   * ModelProvider the request was dispatched to, or null when the gateway
   * did not say. Decides which provider-filtered budgets this spend counts
   * against — see {@link GATEWAY_MODEL_PROVIDER_ID_ATTR}.
   */
  providerKey: string | null;
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

const spanEvents = [spanReceivedEventSchema] as const;

/** Scale `gateway_budget_ledger_events.AmountUSD` is declared with. */
const LEDGER_DECIMAL_SCALE = 10;

/**
 * Serialise a JS number to the fixed-point decimal string ClickHouse expects.
 * Carried over from `gatewayBudgetSync.reactor.ts` so a converted debit is the
 * row the reactor would have written.
 *
 * ONE shape, rejection path included. A non-finite or negative cost is a
 * derivation bug rather than a refund, so it debits nothing — but it debits
 * nothing as `"0.0000000000"`, the fixed-point form every other row carries.
 * A bare `"0"` gives the ledger two spellings of one amount, which is all it
 * takes for a re-derived row to compare unequal to the live row it reproduces.
 */
export function formatLedgerDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) return (0).toFixed(LEDGER_DECIMAL_SCALE);
  return n.toFixed(LEDGER_DECIMAL_SCALE);
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
 * Exported for tests, which exercise the derivation without a queue.
 *
 * **This gate and the `virtualKeyLastUsed` subscriber's differ on purpose,
 * and only after the point where they must agree.** Both start from
 * {@link spanCarriesGatewayVirtualKeyId} — one shared raw-wire predicate, so
 * neither can decide a span is worth normalising when the other would not.
 * Past that they answer different questions:
 *
 *  - the subscriber asks *"was a virtual key used?"*, which a VK id alone
 *    answers, and stamps `lastUsedAt` on the strength of it;
 *  - this asks *"did a billable gateway request complete?"*, which needs a
 *    `GATEWAY_REQUEST_ID_ATTR` as well, because that id IS the ledger's
 *    natural key — a debit without one cannot be deduped against a replay,
 *    so writing it would double-charge the budget on the next rebuild.
 *
 * So a span carrying a VK id and no request id touches `lastUsedAt` and
 * debits nothing, which is the correct reading of both facts rather than a
 * disagreement to reconcile. Do not "unify" them by relaxing the request-id
 * requirement here; that trades a correct silence for a double charge.
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

  const providerKey = span.spanAttributes[GATEWAY_MODEL_PROVIDER_ID_ATTR];

  return {
    tenantId: span.tenantId,
    traceId: span.traceId,
    virtualKeyId,
    gatewayRequestId,
    amountUsd: formatLedgerDecimal(tokens.cost),
    tokensInput: tokens.promptTokens,
    tokensOutput: tokens.completionTokens,
    model: spanCostService.extractModelsFromSpan(span)[0] ?? "unknown",
    providerKey:
      typeof providerKey === "string" && providerKey !== ""
        ? providerKey
        : null,
    status: deriveLedgerStatus(span),
    durationMs: Math.round(span.durationMs),
    occurredAt: new Date(span.startTimeUnixMs),
  };
}

/**
 * ADR-075 Class C (retired; ground now ADR-098): gateway spend as derived state, so replay can rebuild it.
 *
 * Replaces `gatewayBudgetSync.reactor.ts`'s ClickHouse half. The reactor's
 * writes sat outside the event-sourced guarantee — the projection router only
 * ever dispatched a reactor on the live event path and the replay service
 * never invoked one — so a debit lost to a failed handler was lost
 * permanently: the
 * spend happened, the trace recorded it, and the budget never learned. Both of
 * that reactor's failure modes pushed measured spend DOWN, which is the wrong
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
    // Non-gateway spans — the overwhelming majority of the span stream — are
    // rejected on the RAW wire span, before normalisation. Returning null
    // after normalising is NOT cheap: it runs every canonicalisation
    // extractor over the whole attribute set, prompts and completions
    // included, for every span in the product to derive a record that is
    // then thrown away. The raw scan costs one array walk instead. Mirrors
    // `isGovernanceOriginWireSpan` in the two sibling projections and the
    // subscriber's enqueue filter, which is the same predicate.
    if (!spanCarriesGatewayVirtualKeyId(event.data.span)) return null;

    const span = spanNormalizationPipelineService.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    return deriveGatewayDebitRecord(span);
  }
}
