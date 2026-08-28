// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type PulledUsageObservedEvent,
  PulledUsageObservedEventSchema,
} from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import {
  type GatewaySpendConfirmedEvent,
  type GatewaySpendFailedEvent,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/events";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";

import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_ROLLUP_PROJECTION_NAME,
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostSource,
} from "./governanceCostRollup.constants";

/**
 * The events that carry money.
 *
 * `admitted` and `settled` are deliberately absent. Neither carries a cost —
 * admission is a request, settlement is the admission of not knowing — and
 * their dimensions are PRE-resolution: the gateway only settles model and
 * provider after dispatch, so grouping an admission by its requested model
 * would file it under a cell its own outcome never joins, leaving a permanent
 * amount-less row beside the real one.
 */
const governanceCostRollupEvents = [
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  PulledUsageObservedEventSchema,
] as const;

/**
 * One provider item's newest observation, keyed in the state by the item's
 * restatement key.
 */
export interface PulledContribution {
  amountNanoMinor: number;
  /** Monotonic pull time. The ONLY field a restatement can be ordered by. */
  observedAtMs: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  exactOrEstimate: "exact" | "estimate";
}

/**
 * One day x dimension cell of the cost rollup.
 *
 * The dimension fields mirror the table's sort key exactly; anything here that
 * the key omits would be silently deleted by the first background merge.
 */
export interface GovernanceCostRollupState {
  // ---- identity, in sort-key order ----
  /** The provider's business day, `YYYY-MM-DD` in UTC. */
  day: string;
  costSource: GovernanceCostSource | "";
  ingestionSourceId: string;
  provider: string;
  model: string;
  /**
   * The agent/application within the source. RESERVED: neither wave-1 producer
   * names an agent, so this is always empty today. It holds its place in the
   * key so the first producer that does is a new row rather than a table
   * rebuild.
   */
  agentId: string;
  currencyCode: string;
  /** The provider's own actor identifier, exactly as it arrived. */
  rawActorId: string;

  // ---- payload ----
  organizationId: string;
  exactOrEstimate: "" | "exact" | "estimate";

  /**
   * The gateway lane's running total. Gateway outcomes are never restated —
   * one priced outcome per request, which is the same assumption the shipped
   * budget ledger makes (`gatewayDebits` mints one debit per outcome) — so the
   * lane is pure accumulation, made safe against redelivery by the store's
   * applied-event-id watermark rather than by a per-request ledger.
   */
  gatewayAmountNanoMinor: number;
  gatewayTokensInput: number;
  gatewayTokensOutput: number;
  gatewayTokensCacheRead: number;
  gatewayTokensCacheWrite: number;
  gatewayRequestCount: number;

  /**
   * The pulled lane's newest observation per provider item. This is what makes
   * a restatement REPLACE rather than add. Bounded by the number of distinct
   * provider items sharing this one day x dimension cell — one, for the
   * bucketed admin-API pullers wave 1 ships, whose restatement key hashes the
   * same coordinates this cell is keyed by.
   */
  pulledItems: Record<string, PulledContribution>;

  /** How many times a provider has revised this cell, and to what from. */
  revisionCount: number;
  previousAmountNanoUsd: number | null;

  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/** The UTC calendar day an instant belongs to, `YYYY-MM-DD`. */
export function utcDayOf(occurredAtMs: number): string {
  return new Date(occurredAtMs).toISOString().slice(0, 10);
}

/**
 * The dimension tuple an event rolls up into, in sort-key order.
 *
 * Every element is also a column of the table's ORDER BY. The two must stay
 * identical: a dimension the fold groups by and the key omits survives until
 * the first merge and is then deleted, taking one spender's money with it.
 */
function dimensionsOf(event: {
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
}): {
  tenantId: string;
  day: string;
  costSource: GovernanceCostSource;
  ingestionSourceId: string;
  provider: string;
  model: string;
  agentId: string;
  currencyCode: string;
  rawActorId: string;
} {
  if (event.type === PulledUsageObservedEventSchema.shape.type.value) {
    const d = event.data as unknown as PulledUsageObservedEvent["data"];
    return {
      tenantId: event.tenantId,
      day: utcDayOf(d.occurredAtMs),
      costSource: GOVERNANCE_COST_SOURCE.PULLED,
      ingestionSourceId: d.ingestionSourceId,
      provider: d.source,
      model: d.model,
      agentId: "",
      currencyCode: GOVERNANCE_COST_CURRENCY_USD,
      rawActorId: "",
    };
  }
  const d = event.data as unknown as GatewaySpendConfirmedEvent["data"];
  return {
    tenantId: event.tenantId,
    day: utcDayOf(d.occurred_at),
    costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
    ingestionSourceId: "",
    provider: d.model_provider_id,
    model: d.model,
    agentId: "",
    currencyCode: GOVERNANCE_COST_CURRENCY_USD,
    // The spender is the key's principal; the caller's own end user is the
    // fallback for a key with no resolved principal.
    rawActorId: d.principal_user_id || d.end_user_id,
  };
}

/** The dimension tuple a rollup key addresses. */
export type GovernanceCostRollupCell = ReturnType<typeof dimensionsOf>;

/**
 * The fold's group key: the whole dimension tuple, and nothing but.
 *
 * Two properties it has to have. It must be DECODABLE, because the store is
 * handed only this key and has to address a row whose identity is the tuple —
 * the alternative is a key column on the table that the sort key cannot prune,
 * turning every read-back into a scan. And it must be UNAMBIGUOUS: the
 * dimensions are customer-supplied strings, so a delimiter-joined key would
 * let a model named with the delimiter address another cell's row. Hence a
 * base64url payload carrying the whole tuple, behind a human-readable prefix
 * that exists only so a queue group or a log line says what it is.
 */
export function governanceCostRollupKey(event: {
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
}): string {
  return encodeGovernanceCostRollupKey(dimensionsOf(event));
}

/**
 * The key a cell is addressed by. The comparator reaches for this to ask what
 * key a STORED row would have been written under — the alternative, a second
 * copy of the encoding on the read side, is a pair that can disagree, and a
 * watchdog that disagrees with the thing it watches reports drift that is its
 * own.
 */
export function encodeGovernanceCostRollupKey(
  cell: GovernanceCostRollupCell,
): string {
  const payload = Buffer.from(
    JSON.stringify([
      cell.tenantId,
      cell.day,
      cell.costSource,
      cell.ingestionSourceId,
      cell.provider,
      cell.model,
      cell.agentId,
      cell.currencyCode,
      cell.rawActorId,
    ]),
    "utf8",
  ).toString("base64url");
  return `cost1d:${cell.tenantId}:${cell.day}:${cell.costSource}:${payload}`;
}

/**
 * Recovers the dimension tuple a key addresses. Throws rather than guessing:
 * a key this cannot decode means the store is about to write a money row it
 * cannot address, and a silent partial address would overwrite another cell.
 */
export function decodeGovernanceCostRollupKey(
  key: string,
): GovernanceCostRollupCell {
  const payload = key.slice(key.lastIndexOf(":") + 1);
  let tuple: unknown;
  try {
    tuple = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error(`Undecodable governance cost rollup key: ${key}`);
  }
  if (!Array.isArray(tuple) || tuple.length !== 9) {
    throw new Error(`Undecodable governance cost rollup key: ${key}`);
  }
  const [
    tenantId,
    day,
    costSource,
    ingestionSourceId,
    provider,
    model,
    agentId,
    currencyCode,
    rawActorId,
  ] = tuple as string[];
  return {
    tenantId: tenantId!,
    day: day!,
    costSource: costSource as GovernanceCostSource,
    ingestionSourceId: ingestionSourceId!,
    provider: provider!,
    model: model!,
    agentId: agentId!,
    currencyCode: currencyCode!,
    rawActorId: rawActorId!,
  };
}

/**
 * The cell's figures, derived from the two lanes' contributions.
 *
 * `amountNanoUsd` is NULL, never 0, when the cell holds no USD figure — a
 * non-USD provider figure we carry without a rate, or a cell nothing has
 * contributed to yet. Zero is a real amount and charts as free usage; the
 * absence of a figure is a different fact and says so.
 */
export function governanceCostRollupTotals(state: GovernanceCostRollupState): {
  amountNanoUsd: number | null;
  amountNanoMinor: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  requestCount: number;
} {
  const items = Object.values(state.pulledItems);
  const amountNanoMinor =
    state.gatewayAmountNanoMinor +
    items.reduce((sum, item) => sum + item.amountNanoMinor, 0);
  const contributed = state.gatewayRequestCount > 0 || items.length > 0;
  return {
    amountNanoUsd:
      contributed && state.currencyCode === GOVERNANCE_COST_CURRENCY_USD
        ? amountNanoMinor
        : null,
    amountNanoMinor,
    tokensInput:
      state.gatewayTokensInput +
      items.reduce((sum, item) => sum + item.tokensInput, 0),
    tokensOutput:
      state.gatewayTokensOutput +
      items.reduce((sum, item) => sum + item.tokensOutput, 0),
    tokensCacheRead:
      state.gatewayTokensCacheRead +
      items.reduce((sum, item) => sum + item.tokensCacheRead, 0),
    tokensCacheWrite:
      state.gatewayTokensCacheWrite +
      items.reduce((sum, item) => sum + item.tokensCacheWrite, 0),
    requestCount: state.gatewayRequestCount + items.length,
  };
}

/**
 * The daily cost rollup fold (ADR-128 wave 1).
 *
 * Registered on TWO pipelines — gateway spend and pulled usage — because the
 * customer's question ("what did this day cost") spans both lanes and a rollup
 * per pipeline would answer half of it. The two can never contend for a row:
 * `costSource` is part of the key, so a gateway cell and a pulled cell are
 * different cells by construction.
 *
 * The trace lane is RESERVED and excluded: ADR-128 keeps trace cost a separate
 * per-request system, and no pipeline carrying it registers this fold, so no
 * row can carry trace cost under any label.
 *
 * Money is copied, never recomputed: both lanes price once at their own ingest
 * seam and carry an integer nano-USD figure, which this fold sums. Re-pricing
 * is a rebuild against the log, never a side effect of whichever consumer ran
 * after a catalog deploy.
 */
export class GovernanceCostRollupFoldProjection
  extends AbstractFoldProjection<
    GovernanceCostRollupState,
    typeof governanceCostRollupEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements
    FoldEventHandlers<
      typeof governanceCostRollupEvents,
      GovernanceCostRollupState
    >
{
  readonly name = GOVERNANCE_COST_ROLLUP_PROJECTION_NAME;
  readonly version = GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<GovernanceCostRollupState>;

  protected readonly events = governanceCostRollupEvents;

  /**
   * The day x dimension cell, not the event's own aggregate.
   *
   * The base class types the extractor as `(event: { type: string })` because
   * a cross-cutting fold may key off nothing but the type; this one needs the
   * whole event, and the router only ever hands it one of the declared
   * schemas, so the narrowing is safe at every call site.
   */
  readonly key = (event: { type: string }): string =>
    governanceCostRollupKey(
      event as {
        type: string;
        tenantId: string;
        data: Record<string, unknown>;
      },
    );

  readonly options = {
    // The executor's re-fold loads an aggregate's history by
    // `context.aggregateId` (foldProjectionExecutor.ts) — which for these
    // events is ONE gateway request or ONE pulled item, never the day-wide
    // cell this fold groups by. A re-fold would therefore rebuild the whole
    // day out of a single request's events and throw the rest of the day's
    // money away. It is also unnecessary: the accumulators commute, and the
    // restatement rule keys on `observedAtMs` carried by the event rather than
    // on arrival order, so the fold reaches the same state in any order and a
    // replay would derive nothing.
    //
    // For the same reason `refoldOnStoreMiss` must stay off. A future version
    // bump therefore cannot heal itself by replaying: the store reports an
    // older stamp as `undecodable` and the executor THROWS rather than folding
    // onto an empty state, which is the loud failure a money table wants. The
    // migration path for a shape change is rebuilding the table, not a refold.
    refoldOnOutOfOrder: false,
  } as const;

  constructor({
    store,
  }: {
    store: FoldProjectionStore<GovernanceCostRollupState>;
  }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = store;
  }

  protected initState(): Omit<
    GovernanceCostRollupState,
    "createdAt" | "updatedAt" | "LastEventOccurredAt"
  > {
    return {
      day: "",
      costSource: "",
      ingestionSourceId: "",
      provider: "",
      model: "",
      agentId: "",
      currencyCode: GOVERNANCE_COST_CURRENCY_USD,
      rawActorId: "",
      organizationId: "",
      exactOrEstimate: "",
      gatewayAmountNanoMinor: 0,
      gatewayTokensInput: 0,
      gatewayTokensOutput: 0,
      gatewayTokensCacheRead: 0,
      gatewayTokensCacheWrite: 0,
      gatewayRequestCount: 0,
      pulledItems: {},
      revisionCount: 0,
      previousAmountNanoUsd: null,
    };
  }

  handleGatewaySpendConfirmed(
    event: GatewaySpendConfirmedEvent,
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    return this.addGatewayOutcome(event, state);
  }

  /**
   * A failure that already consumed tokens is real spend on several providers,
   * and the shipped budget ledger charges for it. Counting it here keeps the
   * rollup and the ledger stating the same money.
   */
  handleGatewaySpendFailed(
    event: GatewaySpendFailedEvent,
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    return this.addGatewayOutcome(event, state);
  }

  handlePulledUsageObserved(
    event: PulledUsageObservedEvent,
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    const d = event.data;
    const previous = state.pulledItems[d.restatementKey];
    // A restatement is only a restatement if it is NEWER. A redelivered stale
    // observation must not un-correct a figure the provider already fixed.
    if (previous && previous.observedAtMs >= d.observedAtMs) return state;

    const amountBefore = governanceCostRollupTotals(state).amountNanoUsd;
    const dims = dimensionsOf(event as never);
    return {
      ...state,
      ...dims,
      organizationId: d.organizationId,
      exactOrEstimate: d.costStatus,
      pulledItems: {
        ...state.pulledItems,
        [d.restatementKey]: {
          amountNanoMinor: d.costNanoUsd,
          observedAtMs: d.observedAtMs,
          tokensInput: d.tokensInput,
          tokensOutput: d.tokensOutput,
          tokensCacheRead: d.tokensCacheRead,
          tokensCacheWrite: d.tokensCacheWrite,
          exactOrEstimate: d.costStatus,
        },
      },
      revisionCount: previous ? state.revisionCount + 1 : state.revisionCount,
      previousAmountNanoUsd: previous
        ? amountBefore
        : state.previousAmountNanoUsd,
    };
  }

  private addGatewayOutcome(
    event: GatewaySpendConfirmedEvent | GatewaySpendFailedEvent,
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    const d = event.data;
    const usage = d.usage;
    return {
      ...state,
      ...dimensionsOf(event as never),
      organizationId: d.organization_id || state.organizationId,
      // A gateway outcome is the provider's own charge for a served request:
      // there is no later invoice to reconcile it against.
      exactOrEstimate: "exact",
      gatewayAmountNanoMinor: state.gatewayAmountNanoMinor + d.cost_nano_usd,
      gatewayTokensInput: state.gatewayTokensInput + usage.input_tokens,
      gatewayTokensOutput: state.gatewayTokensOutput + usage.output_tokens,
      gatewayTokensCacheRead:
        state.gatewayTokensCacheRead + usage.cache_read_input_tokens,
      gatewayTokensCacheWrite:
        state.gatewayTokensCacheWrite + usage.cache_creation_input_tokens,
      gatewayRequestCount: state.gatewayRequestCount + 1,
    };
  }
}
