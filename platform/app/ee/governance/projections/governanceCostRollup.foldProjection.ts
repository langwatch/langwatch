// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type PulledUsageObservedEvent,
  PulledUsageObservedEventSchema,
  readPulledUsageMoney,
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
  /**
   * The biller's own dollar figure for this item, or null when it published
   * none. Per item rather than per cell because the cell's dollar total may
   * only be stated when EVERY item in it can state one — a partial total
   * reads as the day's whole spend while silently omitting the rest.
   *
   * Absent on contributions written before this existed, which is why it is
   * optional: the map round-trips through `PulledItemsJson` on the stored row.
   */
  amountNanoUsd?: number | null;
  /** Monotonic pull time. The ONLY field a restatement can be ordered by. */
  observedAtMs: number;
  /**
   * What this item held before its most recent CHANGE, when that older
   * figure was observed, and when the change itself was observed. All three
   * absent until an observation actually moves the item's figure.
   *
   * Kept per item rather than as a running cell-level "was $X" because the
   * cell's markers have to be a function of the observations themselves, not
   * of the order the log happened to deliver them in: two items restated in
   * one cell, replayed the other way round, otherwise name a prior total the
   * day never actually held.
   *
   * `priorObservedAtMs` exists to rank evidence, not to be reported: a stale
   * re-delivery may be a closer look at what the item held before the change
   * than the one already recorded, and only the newer of the two should win.
   *
   * Optional for the same reason `amountNanoUsd` is: the map round-trips
   * through `PulledItemsJson` and rows written before this existed have none.
   */
  priorAmountNanoMinor?: number;
  priorAmountNanoUsd?: number | null;
  priorObservedAtMs?: number;
  revisedAtMs?: number;
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

  /**
   * How many times a provider has revised this cell, to what from, and when
   * it last happened.
   *
   * All three answer only to an actual CHANGE in the figure. A re-pull that
   * re-confirms the same amount is an observation, not a revision: treating it
   * as one would make the screen say "revised, was $X" with X equal to the
   * figure on display, a marker that contradicts itself. What such a re-pull
   * does move is `lastObservedAt`.
   *
   * `previousAmountNanoUsd` and `revisedAt` are DERIVED from `pulledItems` on
   * every write rather than accumulated, so that both are a function of the
   * observations alone. Accumulating them read the cell's running total at the
   * moment an event landed, which made a cell holding two restated items name
   * a different prior amount, and a different revision time, depending on
   * which correction the log delivered last.
   *
   * `revisionCount` is the exception: it counts the deliveries that moved the
   * figure, so a log replayed newest-first can under-count. Recovering it
   * exactly needs every observation of an item rather than its newest two.
   *
   * `revisedAt` is epoch ms, taken from the pull that carried the new figure.
   */
  revisionCount: number;
  previousAmountNanoUsd: number | null;
  revisedAt: number | null;

  /**
   * When a pull last TOUCHED this cell, epoch ms — the anchor §15's
   * provisional marker is derived from at read time.
   *
   * Every write that touches the cell moves it, a re-pull confirming an
   * unchanged figure included, because "the provider has stopped moving this
   * day" is exactly what such a pull observes and the only thing that can ever
   * let a day read as settled.
   *
   * The value is the PULL'S OWN observation timestamp off the event, never the
   * wall clock: a clock read would stamp every day with today on replay and
   * break rebuild-equals-replay. Kept as a running MAX so the fold stays
   * commutative — it has no re-fold path and events may arrive in any order,
   * so a late-delivered older observation must not drag the anchor backwards.
   *
   * Not `LastEventOccurredAt`, which is provider-side event time and stands
   * still in precisely the case this exists to see.
   */
  lastObservedAt: number;

  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * What an item records about its own last change, after a pull newer than
 * anything it has seen.
 *
 * Only a pull that MOVES the figure rewrites what came before it. A confirming
 * re-pull carries the existing markers forward untouched, so a settled
 * "revised, was $X" survives the day being looked at again.
 */
function revisionMarkersAfterPull(
  previous: PulledContribution | undefined,
  movedTheFigure: boolean,
  observedAtMs: number,
): Pick<
  PulledContribution,
  | "priorAmountNanoMinor"
  | "priorAmountNanoUsd"
  | "priorObservedAtMs"
  | "revisedAtMs"
> {
  if (movedTheFigure && previous !== undefined) {
    return {
      priorAmountNanoMinor: previous.amountNanoMinor,
      priorAmountNanoUsd: previous.amountNanoUsd,
      priorObservedAtMs: previous.observedAtMs,
      revisedAtMs: observedAtMs,
    };
  }
  return {
    priorAmountNanoMinor: previous?.priorAmountNanoMinor,
    priorAmountNanoUsd: previous?.priorAmountNanoUsd,
    priorObservedAtMs: previous?.priorObservedAtMs,
    revisedAtMs: previous?.revisedAtMs,
  };
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
      // The currency the PROVIDER billed in, carried from the event. A cell is
      // keyed by it, so a day billed in two currencies is two rows and nothing
      // can sum across them (ADR-128 §3).
      //
      // Read through `readPulledUsageMoney` because nothing parses these
      // events on the way in here: an event predating currencies would
      // otherwise put `undefined` in the key, and a rebuild would address
      // every historical cell under a key the stored row does not have.
      currencyCode: readPulledUsageMoney(d).currencyCode,
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
    // The gateway prices every outcome off its own dollar-denominated rate
    // table, so this lane has one currency and it is not read off the event.
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
 * The dollar figure for a cell, or null when nobody can honestly state one.
 *
 * Three cases, and the order matters. A cell nothing has contributed to has no
 * figure at all. A cell billed in dollars needs no conversion — the amount IS
 * the dollar amount, for either lane. A cell billed in anything else can only
 * be stated in dollars by the BILLER, so it is the sum of the biller's own
 * per-item figures, and only when every item carries one: a partial sum reads
 * as the day's whole spend while silently omitting the part nobody converted.
 *
 * No rate is applied here or anywhere else (ADR-128 §3). Null, never 0: zero
 * is a real amount and charts as free usage, while the absence of a figure is
 * a different fact and has to say so.
 */
function amountNanoUsdOf({
  state,
  amountNanoMinor,
  contributed,
}: {
  state: GovernanceCostRollupState;
  amountNanoMinor: number;
  contributed: boolean;
}): number | null {
  if (!contributed) return null;
  if (state.currencyCode === GOVERNANCE_COST_CURRENCY_USD) {
    return amountNanoMinor;
  }
  // Below here the cell is not in dollars. The gateway lane never is, so a
  // gateway contribution in a non-dollar cell is a cell we cannot state.
  if (state.gatewayRequestCount > 0) return null;

  const items = Object.values(state.pulledItems);
  let total = 0;
  for (const item of items) {
    const billerUsd = item.amountNanoUsd ?? null;
    if (billerUsd === null) return null;
    total += billerUsd;
  }
  return total;
}

/**
 * The cell's figures, derived from the two lanes' contributions.
 *
 * `amountNanoUsd` is NULL, never 0, when the cell holds no USD figure — see
 * `amountNanoUsdOf` for the three cases.
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
    amountNanoUsd: amountNanoUsdOf({ state, amountNanoMinor, contributed }),
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
      revisedAt: null,
      lastObservedAt: 0,
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
    // Same reason as the key: an event written before money carried a
    // currency names its amount `costNanoUsd`, and read literally that amount
    // would be `undefined` here and every total from this cell onward `NaN`.
    const money = readPulledUsageMoney(d);

    if (previous && previous.observedAtMs >= d.observedAtMs) {
      return this.foldStaleObservation(state, previous, d);
    }

    const movedTheFigure =
      previous !== undefined &&
      previous.amountNanoMinor !== money.costNanoMinor;
    const dims = dimensionsOf(event as never);
    const observed: GovernanceCostRollupState = {
      ...state,
      ...dims,
      organizationId: d.organizationId,
      exactOrEstimate: d.costStatus,
      pulledItems: {
        ...state.pulledItems,
        [d.restatementKey]: {
          amountNanoMinor: money.costNanoMinor,
          amountNanoUsd: money.costNanoUsd,
          observedAtMs: d.observedAtMs,
          ...revisionMarkersAfterPull(previous, movedTheFigure, d.observedAtMs),
          tokensInput: d.tokensInput,
          tokensOutput: d.tokensOutput,
          tokensCacheRead: d.tokensCacheRead,
          tokensCacheWrite: d.tokensCacheWrite,
          exactOrEstimate: d.costStatus,
        },
      },
      // Every pull that reaches here touched the day, whether or not it moved
      // the money — that is the whole point of the anchor. MAX rather than
      // assignment because a second item's older observation must not drag it
      // back; the early return above only guards re-delivery of the SAME item.
      lastObservedAt: Math.max(state.lastObservedAt, d.observedAtMs),
      revisionCount: movedTheFigure
        ? state.revisionCount + 1
        : state.revisionCount,
    };

    return this.withDerivedRevisionMarkers(observed);
  }

  /**
   * Folds an observation that is NOT newer than the one the item already
   * holds.
   *
   * Such a re-delivery must not un-correct a figure the provider already
   * fixed, but it is not worthless either: it is evidence of what the item
   * held at an EARLIER time, which is exactly what "was $X" needs. Taking it
   * is what lets a log delivered newest-first reach the same markers as an
   * in-order one.
   */
  private foldStaleObservation(
    state: GovernanceCostRollupState,
    previous: PulledContribution,
    d: PulledUsageObservedEvent["data"],
  ): GovernanceCostRollupState {
    const money = readPulledUsageMoney(d);
    // Only a stale look that DIFFERS from where the item stands now is
    // evidence of a change, and only the newest such look is the figure the
    // item held immediately before it.
    const revealsChange = money.costNanoMinor !== previous.amountNanoMinor;
    const isCloserLook =
      d.observedAtMs < previous.observedAtMs &&
      (previous.priorObservedAtMs === undefined ||
        d.observedAtMs > previous.priorObservedAtMs);
    if (!revealsChange || !isCloserLook) return state;

    return this.withDerivedRevisionMarkers({
      ...state,
      pulledItems: {
        ...state.pulledItems,
        [d.restatementKey]: {
          ...previous,
          priorAmountNanoMinor: money.costNanoMinor,
          priorAmountNanoUsd: money.costNanoUsd,
          priorObservedAtMs: d.observedAtMs,
          // The change landed somewhere between this look and the newest one.
          // The newest is the only bound the log actually witnessed.
          revisedAtMs: previous.observedAtMs,
        },
      },
    });
  }

  /**
   * Restates the cell's "revised, was $X" markers from the item map.
   *
   * Derived rather than accumulated because the accumulating version read the
   * running total at the moment an event landed, so a cell holding two items
   * reported a different prior amount — and a different revision time —
   * depending on which restatement the log delivered last. Recomputing from
   * the items makes both a function of the observations alone.
   */
  private withDerivedRevisionMarkers(
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    let newestKey: string | null = null;
    let revisedAt: number | null = null;

    for (const [key, item] of Object.entries(state.pulledItems)) {
      // A revision is a CHANGE to the figure, not merely a second look at it.
      // The provider re-reporting the same amount is the confirming
      // observation §15 relies on, and treating it as a revision would put
      // "revised, was $X" on a cell whose X never moved. Items that never
      // moved carry no `revisedAtMs` at all.
      if (item.revisedAtMs === undefined) continue;
      // Ties broken by key so two items revised in the same pull still name
      // one winner, whichever order they arrived in.
      if (
        revisedAt === null ||
        item.revisedAtMs > revisedAt ||
        (item.revisedAtMs === revisedAt && key < newestKey!)
      ) {
        revisedAt = item.revisedAtMs;
        newestKey = key;
      }
    }

    if (newestKey === null) {
      return { ...state, revisedAt: null, previousAmountNanoUsd: null };
    }

    // "was $X" is the whole cell as it stood immediately before its newest
    // revision: that one item at its prior figure, every other item where it
    // stands now. Totalled through the same helper the live figure uses, so
    // the two cannot drift on currency handling.
    const newest = state.pulledItems[newestKey]!;
    const before = governanceCostRollupTotals({
      ...state,
      pulledItems: {
        ...state.pulledItems,
        [newestKey]: {
          ...newest,
          amountNanoMinor: newest.priorAmountNanoMinor!,
          amountNanoUsd: newest.priorAmountNanoUsd,
        },
      },
    }).amountNanoUsd;

    return { ...state, revisedAt, previousAmountNanoUsd: before };
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
      // We metered this as we served it, so serving time IS observation time
      // for this lane — same column, same meaning, no clock read. It never
      // makes a gateway day render provisional: nothing restates a gateway
      // outcome, so the read side exempts the lane outright rather than
      // relying on the arithmetic to come out right (§15).
      lastObservedAt: Math.max(state.lastObservedAt, d.occurred_at),
      // `revisedAt`, `revisionCount` and `previousAmountNanoUsd` stay
      // untouched: one priced outcome per request, never restated.
    };
  }
}
