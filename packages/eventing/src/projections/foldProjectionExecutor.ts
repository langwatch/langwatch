import { createLogger } from "@langwatch/observability";

import type { Event } from "../domain/types.ts";
import {
  incrementEsFoldAbsentMissTrustedTotal,
  incrementEsFoldDuplicateEventsSkipped,
  incrementEsFoldReadWindowFallbackTotal,
  incrementEsFoldRefoldOnMissTotal,
  incrementEsFoldRefoldTotal,
  observeEsFoldBlindReapplyEvents,
} from "../metrics.ts";
import { compareOrdinal } from "../utils/compareOrdinal.ts";
import { mergeAppliedEventIds } from "./foldCache/foldCacheEntry.ts";
import type { FoldProjectionDefinition } from "./foldProjection.types.ts";
import { type ProjectionStoreContext, readWindowAround } from "./projectionStoreContext.ts";

const logger = createLogger("langwatch:event-sourcing:fold-executor");

/**
 * Event ids carried in a blind-reapply log line. A coalesced batch can hold up
 * to COALESCE_MAX_BATCH events; the ids are for identifying which aggregates to
 * reconcile afterwards, and a handful is enough to find the trace.
 */
const MAX_LOGGED_EVENT_IDS = 10;

/**
 * Projections that already warned about a read-window recovery this process.
 * Bounded by the number of registered projections; see the warn site.
 */
const readWindowRecoveryWarned = new Set<string>();

/**
 * What a re-fold history read still misses before it may replace the loaded
 * state. See `FoldProjectionExecutor.historyReadGap`.
 */
type HistoryReadGap = {
  missingAppliedIds: string[];
  isFrontierMissing: boolean;
};

/**
 * Arrival time, then the id: the order of two events the event log accepted,
 * and the tie-break for two that carry the same business time. The id is what
 * keeps two replays of one history from disagreeing.
 */
function compareArrival(a: Event, b: Event): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return compareOrdinal(a.id, b.id);
}

function compareFoldEvents<State, E extends Event>(
  projection: FoldProjectionDefinition<State, E>,
  a: E,
  b: E,
): number {
  if (projection.options?.eventOrdering === "acceptedAt") {
    return compareArrival(a, b);
  }

  // Business time first, then arrival. Two events can share one `occurredAt`:
  // a fold that re-reads its history merges the delivered events back in, and
  // a tie there would keep whatever order the merge produced rather than the
  // order the events arrived in, so a last-write-wins fold could commit the
  // earlier one.
  if (a.occurredAt !== b.occurredAt) return a.occurredAt - b.occurredAt;
  return compareArrival(a, b);
}

/**
 * Whether an out-of-order event should replay history rather than apply on top of
 * loaded state. See `FoldProjectionOptions.refoldOnOutOfOrder` for the opt-out;
 * accepted-order folds never enter this path.
 */
function canRefold<State, E extends Event>(
  projection: FoldProjectionDefinition<State, E>,
  context: ProjectionStoreContext,
): boolean {
  if (projection.options?.refoldOnOutOfOrder === false) {
    incrementEsFoldRefoldTotal(projection.name, "declined");
    return false;
  }
  if (!projection.eventLoader) {
    incrementEsFoldRefoldTotal(projection.name, "unavailable");
    logger.warn(
      { projection: projection.name, aggregateId: context.aggregateId },
      "Out-of-order event detected but no eventLoader available — cannot re-fold",
    );
    return false;
  }
  incrementEsFoldRefoldTotal(projection.name, "performed");
  return true;
}

/**
 * Carries the event's occurredAt and, when the fold declares `options.readWindow`,
 * the computed `occurredAt ± widthMs` bound. Returned unchanged when occurredAt is
 * unusable, since it cannot anchor a window — the read then stays unbounded.
 */
function withReadHints<State, E extends Event>({
  context,
  event,
  projection,
}: {
  context: ProjectionStoreContext;
  event: Event;
  projection: FoldProjectionDefinition<State, E>;
}): ProjectionStoreContext {
  const occurredAt = (event as Record<string, unknown>).occurredAt;
  if (typeof occurredAt !== "number" || occurredAt <= 0) return context;
  const widthMs = projection.options?.readWindow?.widthMs;
  return {
    ...context,
    occurredAtMs: occurredAt,
    ...(widthMs !== undefined
      ? { readWindow: readWindowAround({ anchorMs: occurredAt, widthMs }) }
      : {}),
  };
}

/**
 * Returns a context recording which events this fold step applied, so a caching
 * store can recognise them if the queue redelivers the same batch.
 */
function withAppliedEventIds(
  context: ProjectionStoreContext,
  appliedEventIds: readonly string[],
): ProjectionStoreContext {
  return { ...context, appliedEventIds };
}

function applyUnseenEvents<State, E extends Event>({
  projection,
  events,
  seen,
  state,
}: {
  projection: FoldProjectionDefinition<State, E>;
  events: readonly Event[];
  seen: Set<string>;
  state: State;
}): { state: State; appliedCount: number } {
  let next = state;
  let appliedCount = 0;
  for (const event of events) {
    const dedupKey = event.idempotencyKey || event.id;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    next = projection.apply(next, event as E);
    appliedCount++;
  }
  return { state: next, appliedCount };
}

// Incremental fold execution: load state, re-fold on miss/out-of-order,
// apply event, store result. See ADR-066 for store-miss and re-fold logic.
export class FoldProjectionExecutor {
  /**
   * Events per page for the streaming store-miss re-fold. Bounds the working set —
   * 1000 keeps per-page memory small while amortising the round-trip. Injected so
   * tests can force multi-page runs.
   */
  private readonly refoldPageSize: number;

  /** Backoff between re-reads of an incomplete re-fold history. */
  private readonly refoldHistoryRetryDelaysMs: readonly number[];

  constructor({
    refoldPageSize = 1000,
    refoldHistoryRetryDelaysMs = [50, 150],
  }: {
    refoldPageSize?: number;
    refoldHistoryRetryDelaysMs?: readonly number[];
  } = {}) {
    this.refoldPageSize = refoldPageSize;
    this.refoldHistoryRetryDelaysMs = refoldHistoryRetryDelaysMs;
  }

  // Loads state with applied-event-id set for dedup. Windowed read retries
  // unwindowed once to find rows outside window; skipped if trustAbsentMiss set.
  private async loadWithApplied<State, E extends Event>({
    projection,
    key,
    context,
  }: {
    projection: FoldProjectionDefinition<State, E>;
    key: string;
    context: ProjectionStoreContext;
  }): Promise<{
    state: State | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const projectionName = projection.name;
    const store = projection.store;
    const read = async (
      readContext: ProjectionStoreContext,
    ): Promise<{
      state: State | null;
      appliedEventIds: string[];
      miss?: "absent" | "undecodable";
    }> => {
      if (store.getWithApplied) {
        return store.getWithApplied(key, readContext);
      }
      // A get()-only store has no way to say "found but refused", so its null
      // is always an absent miss; stamping it keeps the miss kind uniform for
      // the refold gate and `trustAbsentMiss` downstream.
      const state = await store.tryGet(key, readContext);
      return {
        state,
        appliedEventIds: [],
        ...(state === null ? { miss: "absent" as const } : {}),
      };
    };

    const windowed = await read(context);
    if (windowed.state !== null || context.readWindow === undefined) {
      return windowed;
    }
    // An undecodable row was FOUND and refused, so widening the scope re-reads
    // the same row to refuse it again. Skipping the retry saves an unpruned
    // scan per event per stale aggregate, and keeps the fallback counter
    // meaning "the window missed a live aggregate" rather than absorbing a
    // schema condition that has nothing to do with the window.
    if (windowed.miss === "undecodable") {
      return windowed;
    }
    if (this.trustsAbsentMiss(projection)) {
      incrementEsFoldAbsentMissTrustedTotal(projectionName, "fallback_read");
      return windowed;
    }

    // The retry drops the window and bypasses the read cache: the windowed
    // attempt consulted the cache moments ago, so a second cache read is a
    // guaranteed miss that would only skew the cache metrics.
    const { readWindow: _readWindow, ...rest } = context;
    const unwindowed = await read({ ...rest, bypassReadCache: true });
    incrementEsFoldReadWindowFallbackTotal(
      projectionName,
      unwindowed.state !== null ? "recovered" : "absent",
    );
    if (unwindowed.state !== null) {
      // A chronically-wrong width would otherwise warn per event; the metric's
      // `recovered` counter is the ongoing signal, so warn once per projection
      // per process and drop to debug after that.
      const level = readWindowRecoveryWarned.has(projectionName)
        ? ("debug" as const)
        : ("warn" as const);
      readWindowRecoveryWarned.add(projectionName);
      logger[level](
        {
          projection: projectionName,
          tenantId: String(context.tenantId),
          aggregateId: context.aggregateId,
          readWindow: context.readWindow,
        },
        "Fold state found outside the declared read window — the window missed a live aggregate; widen readWindow.widthMs if this recurs",
      );
    }
    return unwindowed;
  }

  /**
   * The applied-event-id set to record at commit: fresh deliveries reset to
   * this batch only; retries must UNION with the loaded set to avoid re-applying
   * events from earlier attempts (silent double-count).
   */
  private appliedIdsForCommit({
    context,
    loadedAppliedIds,
    deliveredIds,
  }: {
    context: ProjectionStoreContext;
    loadedAppliedIds: readonly string[];
    deliveredIds: readonly string[];
  }): string[] {
    // Replace ONLY on the first commit of a fresh delivery (GC); otherwise
    // extend to preserve prior attempts and sub-batches, preventing re-applies.
    const isRetry = (context.deliveryAttempt ?? 1) > 1;
    return isRetry || context.isDeliveryContinuation
      ? mergeAppliedEventIds({
          previous: loadedAppliedIds,
          applied: deliveredIds,
        })
      : [...deliveredIds];
  }

  // Drops events already folded (queue is at-least-once; re-apply would
  // double-count in accumulators).
  private dropAlreadyApplied<E extends Event>({
    projectionName,
    events,
    appliedEventIds,
    context,
  }: {
    projectionName: string;
    events: E[];
    appliedEventIds: readonly string[];
    context: ProjectionStoreContext;
  }): E[] {
    if (events.length === 0) return events;

    if (appliedEventIds.length === 0) {
      // A retry with no record of what an earlier attempt applied cannot tell a
      // redelivery from a fresh event, so everything here is about to be folded
      // on top of state that may already contain it. `dedup_unavailable` counts
      // that this happened; this records how much it is about to re-apply.
      if ((context.deliveryAttempt ?? 1) > 1) {
        observeEsFoldBlindReapplyEvents(projectionName, events.length);
        logger.warn(
          {
            projection: projectionName,
            tenantId: context.tenantId,
            aggregateId: context.aggregateId,
            deliveryAttempt: context.deliveryAttempt,
            reapplying: events.length,
            eventIds: events.slice(0, MAX_LOGGED_EVENT_IDS).map((e) => e.id),
          },
          "Retry has no applied-event-id set — re-folding events that may already be in the stored state (accumulating folds will double-count)",
        );
      }
      return events;
    }

    const applied = new Set(appliedEventIds);
    const fresh = events.filter((event) => !applied.has(event.id));
    const skipped = events.length - fresh.length;

    if (skipped > 0) {
      incrementEsFoldDuplicateEventsSkipped(projectionName, skipped);
      logger.info(
        { projection: projectionName, skipped, delivered: events.length },
        "Skipped redelivered events already folded into the cached state",
      );
    }
    return fresh;
  }

  async execute<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
    context: ProjectionStoreContext,
  ): Promise<State> {
    if (!this.matchesEventTypes(projection, event)) {
      return projection.init();
    }

    const key = context.key ?? context.aggregateId;
    // Anchor the store read to the event's business time. A fold that declared
    // a read window gets its backing read bounded to occurredAt ± widthMs, with
    // the executor retrying unwindowed on a miss (see loadWithApplied).
    const loadContext = withReadHints({ context, event, projection });
    const {
      state: loaded,
      appliedEventIds,
      miss,
    } = await this.loadWithApplied({
      projection,
      key,
      context: loadContext,
    });
    if (loaded === null) this.assertUndecodableIsRecoverable(projection, miss);

    // A trusted absent miss folds from init() without replaying event_log: the store
    // always writes a row, so no row means nothing was ever committed. `undecodable`
    // does not take this shortcut — there a complete row exists and re-fold is what
    // makes refusing it safe.
    const absentTrusted = loaded === null && miss === "absent" && this.trustsAbsentMiss(projection);
    if (absentTrusted && this.shouldRefoldOnMiss(projection)) {
      incrementEsFoldAbsentMissTrustedTotal(projection.name, "refold");
    }

    const missResult = await this.handleAbsentMiss({
      projection,
      event,
      context,
      loaded,
      miss,
      absentTrusted,
      appliedEventIds,
    });
    if (missResult.handled) return missResult.state;

    // A redelivery of an event already folded into the loaded state: the state
    // is already correct, so there is nothing to apply and nothing to write.
    if (
      this.dropAlreadyApplied({
        projectionName: projection.name,
        events: [event],
        appliedEventIds,
        context,
      }).length === 0
    ) {
      return loaded ?? projection.init();
    }

    const loadedState = loaded ?? projection.init();

    // Capture the highest occurredAt before applying the new event.
    const prevLastOccurred =
      (loadedState as Record<string, unknown>)[projection.LastEventOccurredAtKey] ?? 0;

    let state = projection.apply(loadedState, event);

    state = await this.applyOutOfOrderRefold({
      projection,
      event,
      context,
      state,
      prevLastOccurred,
      appliedEventIds,
    });

    await projection.store.store(
      state,
      withAppliedEventIds(
        context,
        this.appliedIdsForCommit({
          context,
          loadedAppliedIds: appliedEventIds,
          deliveredIds: [event.id],
        }),
      ),
    );
    return state;
  }

  /**
   * The absent-miss re-fold branch of `execute`: re-folds from scratch and commits
   * when nothing is loaded, the miss isn't trusted absent, and the projection opts in.
   * Extracted so its branching is counted apart from `execute`'s complexity.
   */
  private async handleAbsentMiss<State, E extends Event>({
    projection,
    event,
    context,
    loaded,
    miss,
    absentTrusted,
    appliedEventIds,
  }: {
    projection: FoldProjectionDefinition<State, E>;
    event: E;
    context: ProjectionStoreContext;
    loaded: State | null;
    miss: "absent" | "undecodable" | undefined;
    absentTrusted: boolean;
    appliedEventIds: readonly string[];
  }): Promise<{ handled: true; state: State } | { handled: false }> {
    if (loaded !== null || absentTrusted || !this.shouldRefoldOnMiss(projection)) {
      return { handled: false };
    }

    const refolded = await this.refoldUpToDelivered(projection, [event], context);
    // The ADR-066 transitional net, made observable: its deletion condition is
    // "it stopped firing", which is otherwise indistinguishable from a
    // regression to the pre-ADR-066 steady state of refolding on every miss.
    incrementEsFoldRefoldOnMissTotal(projection.name, refolded === null ? "absent" : "performed");
    if (refolded !== null) {
      await projection.store.store(
        refolded,
        withAppliedEventIds(
          context,
          this.appliedIdsForCommit({
            context,
            loadedAppliedIds: appliedEventIds,
            deliveredIds: [event.id],
          }),
        ),
      );
      return { handled: true, state: refolded };
    }
    this.assertUndecodableWasRebuilt(projection, miss);
    return { handled: false };
  }

  /**
   * The out-of-order re-fold branch of `execute`: fires when occurredAt is STRICTLY
   * LESS than what we've already seen — same occurredAt (==) does NOT re-fold, since
   * arrival order is the correct tiebreaker for events at the same logical instant.
   */
  private async applyOutOfOrderRefold<State, E extends Event>({
    projection,
    event,
    context,
    state,
    prevLastOccurred,
    appliedEventIds,
  }: {
    projection: FoldProjectionDefinition<State, E>;
    event: E;
    context: ProjectionStoreContext;
    state: State;
    prevLastOccurred: unknown;
    appliedEventIds: readonly string[];
  }): Promise<State> {
    const eventOccurredAt = (event as Record<string, unknown>).occurredAt;
    const isOutOfOrder =
      projection.options?.eventOrdering !== "acceptedAt" &&
      typeof eventOccurredAt === "number" &&
      eventOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      eventOccurredAt < prevLastOccurred &&
      canRefold(projection, context);
    if (!isOutOfOrder) return state;

    // CanRefold returns false without an eventLoader.
    const refolded = await this.refoldWithDelivered({
      projection,
      delivered: [event],
      context,
      occurredAtMs: eventOccurredAt as number,
      loadedAppliedIds: appliedEventIds,
      stateFrontierOccurredAtMs: prevLastOccurred as number,
      logFields: { eventType: event.type, eventOccurredAt, prevLastOccurred },
      message: "Out-of-order event detected, re-folding from scratch",
    });
    // An incomplete history read returns null: the loaded state stays the
    // base and the event stays applied on top, out of order but not lost.
    return refolded !== null ? refolded : state;
  }

  /**
   * Applies a batch of events in one load/store cycle (O(n) vs O(n²)).
   * Re-folds from scratch if the earliest event is out-of-order.
   */
  async executeBatch<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    events: E[],
    context: ProjectionStoreContext,
  ): Promise<State> {
    const matching = events.filter((event) => this.matchesEventTypes(projection, event));
    if (matching.length === 0) {
      return projection.init();
    }
    if (matching.length === 1) {
      return this.execute(projection, matching[0]!, context);
    }

    // Most folds follow business time. Lifecycle folds may instead select the
    // canonical accepted cursor so a backdated transition cannot jump ahead of
    // an event the log accepted first.
    const ordered = [...matching].toSorted((a, b) => compareFoldEvents(projection, a, b));

    const key = context.key ?? context.aggregateId;
    // Anchor the read to the batch's earliest event (any event in the batch is
    // for the same aggregate, so it anchors the same partition window; the
    // unwindowed retry covers a batch that somehow spans wider than widthMs).
    // The empty/single-event batches returned above, so ordered has at least two events.
    const loadContext = withReadHints({
      context,
      event: ordered[0]!,
      projection,
    });
    const {
      state: loaded,
      appliedEventIds,
      miss,
    } = await this.loadWithApplied({
      projection,
      key,
      context: loadContext,
    });
    if (loaded === null) this.assertUndecodableIsRecoverable(projection, miss);

    // Same trusted-absent shortcut as the single-event path above.
    const absentTrusted = loaded === null && miss === "absent" && this.trustsAbsentMiss(projection);
    if (absentTrusted && this.shouldRefoldOnMiss(projection)) {
      incrementEsFoldAbsentMissTrustedTotal(projection.name, "refold");
    }

    if (loaded === null && !absentTrusted && this.shouldRefoldOnMiss(projection)) {
      const refolded = await this.refoldUpToDelivered(projection, ordered, context);
      // Counted as on the single-event path above.
      incrementEsFoldRefoldOnMissTotal(projection.name, refolded === null ? "absent" : "performed");
      if (refolded !== null) {
        await projection.store.store(
          refolded,
          withAppliedEventIds(
            context,
            this.appliedIdsForCommit({
              context,
              loadedAppliedIds: appliedEventIds,
              deliveredIds: ordered.map((event) => event.id),
            }),
          ),
        );
        return refolded;
      }
      this.assertUndecodableWasRebuilt(projection, miss);
    }

    const fresh = this.dropAlreadyApplied({
      projectionName: projection.name,
      events: ordered,
      appliedEventIds,
      context,
    });
    // Every event in the batch was a redelivery — the loaded state already
    // reflects them all, so re-storing it would only churn the durable row.
    if (fresh.length === 0) {
      return loaded ?? projection.init();
    }

    const loadedState = loaded ?? projection.init();

    const prevLastOccurred =
      (loadedState as Record<string, unknown>)[projection.LastEventOccurredAtKey] ?? 0;
    const earliestOccurredAt = (fresh[0] as Record<string, unknown>).occurredAt;

    // Out-of-order vs the persisted checkpoint: the batch starts earlier than
    // what we've already folded. Re-fold from scratch when we can load the full
    // history AND the projection still gains something by replaying it;
    // otherwise apply the batch on top (matches the single-event executor's
    // degraded behavior when no eventLoader exists).
    const isOutOfOrder =
      projection.options?.eventOrdering !== "acceptedAt" &&
      typeof earliestOccurredAt === "number" &&
      earliestOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      earliestOccurredAt < prevLastOccurred;

    let state = loadedState;
    let refolded: State | null = null;
    if (isOutOfOrder && canRefold(projection, context)) {
      // CanRefold returns false without an eventLoader.
      // `ordered`, not `fresh`: the replay discards the loaded state, so a
      // redelivered event the history read misses has to be folded in too.
      refolded = await this.refoldWithDelivered({
        projection,
        delivered: ordered,
        context,
        occurredAtMs: earliestOccurredAt,
        loadedAppliedIds: appliedEventIds,
        stateFrontierOccurredAtMs: typeof prevLastOccurred === "number" ? prevLastOccurred : 0,
        logFields: {
          batchSize: ordered.length,
          earliestOccurredAt,
          prevLastOccurred,
        },
        message: "Out-of-order batch detected, re-folding from scratch",
      });
    }
    if (refolded !== null) {
      state = refolded;
    } else {
      // No replay, or the history read was incomplete (null): the loaded
      // state stays the base and the batch is applied on top, out of order
      // but with nothing already folded thrown away.
      for (const event of fresh) {
        state = projection.apply(state, event);
      }
    }

    await projection.store.store(
      state,
      withAppliedEventIds(
        context,
        this.appliedIdsForCommit({
          context,
          loadedAppliedIds: appliedEventIds,
          // `ordered`, not `fresh`: an id dropped as already-applied is still
          // an id the state being committed absorbs, so the set must keep
          // vouching for it. Recording only the freshly-folded ids EVICTS a
          // redelivered id that rode along, and whoever sees it next folds it
          // a second time (#6578).
          deliveredIds: ordered.map((event) => event.id),
        }),
      ),
    );
    return state;
  }

  /**
   * Out-of-order re-fold: replays the aggregate's history, detecting incomplete
   * reads via applied-id and occurred-at fences. Returns null if fences fail
   * after retry, leaving delivery applied on top of the loaded state.
   */
  private async refoldWithDelivered<State, E extends Event>({
    projection,
    delivered,
    context,
    occurredAtMs,
    loadedAppliedIds,
    stateFrontierOccurredAtMs,
    logFields,
    message,
  }: {
    projection: FoldProjectionDefinition<State, E>;
    delivered: readonly E[];
    context: ProjectionStoreContext;
    occurredAtMs: number;
    /** Event ids the loaded state was committed with (the previous batch). */
    loadedAppliedIds: readonly string[];
    /** The loaded state's occurred-at high-water mark, 0 when unknown. */
    stateFrontierOccurredAtMs: number;
    logFields: Record<string, unknown>;
    message: string;
  }): Promise<State | null> {
    const { history, gap } = await this.readHistoryUntilComplete({
      projection,
      delivered,
      context,
      occurredAtMs,
      loadedAppliedIds,
      stateFrontierOccurredAtMs,
    });
    if (gap) {
      incrementEsFoldRefoldTotal(projection.name, "incomplete");
      logger.error(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          ...logFields,
          refoldEventCount: history.length,
          missingAppliedIds: gap.missingAppliedIds.slice(0, MAX_LOGGED_EVENT_IDS),
          isFrontierMissing: gap.isFrontierMissing,
          stateFrontierOccurredAtMs,
        },
        "Re-fold history read stayed incomplete after retries; keeping the loaded state and applying the delivery on top",
      );
      return null;
    }

    const seen = new Set(history.map((e) => e.id));
    const missing = delivered.filter((e) => !seen.has(e.id));
    const combined = [...(history as E[]), ...missing].toSorted((a, b) =>
      compareFoldEvents(projection, a, b),
    );

    logger.info(
      {
        projection: projection.name,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        ...logFields,
        refoldEventCount: history.length,
        missingDeliveredCount: missing.length,
      },
      message,
    );
    if (missing.length > 0) {
      logger.warn(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          missingEventIds: missing.map((e) => e.id).slice(0, MAX_LOGGED_EVENT_IDS),
        },
        "Re-fold history read did not return a delivered event; folding it in from the delivery",
      );
    }

    let state = projection.init();
    for (const e of combined) {
      state = projection.apply(state, e);
    }
    return state;
  }

  /**
   * Reads the aggregate's history, re-reading on a short backoff while a fence still
   * reports a gap (see `historyReadGap`). Returns the last read with the gap that
   * stands after retries, null once the read covers everything the loaded state holds.
   */
  private async readHistoryUntilComplete<State, E extends Event>({
    projection,
    delivered,
    context,
    occurredAtMs,
    loadedAppliedIds,
    stateFrontierOccurredAtMs,
  }: {
    projection: FoldProjectionDefinition<State, E>;
    delivered: readonly E[];
    context: ProjectionStoreContext;
    occurredAtMs: number;
    loadedAppliedIds: readonly string[];
    stateFrontierOccurredAtMs: number;
  }): Promise<{
    history: Event[];
    gap: HistoryReadGap | null;
  }> {
    const loadHistory = () =>
      // Callers guard eventLoader is set (canRefold).
      projection.eventLoader!({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs,
      });
    const gapOf = (history: readonly Event[]) =>
      this.historyReadGap({
        history,
        delivered,
        loadedAppliedIds,
        stateFrontierOccurredAtMs,
      });

    let history = await loadHistory();
    let gap = gapOf(history);
    for (const delayMs of this.refoldHistoryRetryDelaysMs) {
      if (!gap) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      history = await loadHistory();
      gap = gapOf(history);
    }
    return { history, gap };
  }

  /**
   * Returns missing applied ids or occurred-at checkpoint; null when the read
   * is complete enough to replay (fences against read lag only).
   */
  private historyReadGap<E extends Event>({
    history,
    delivered,
    loadedAppliedIds,
    stateFrontierOccurredAtMs,
  }: {
    history: readonly Event[];
    delivered: readonly E[];
    loadedAppliedIds: readonly string[];
    stateFrontierOccurredAtMs: number;
  }): HistoryReadGap | null {
    const accounted = new Set<string>(history.map((e) => e.id));
    for (const e of delivered) accounted.add(e.id);
    const missingAppliedIds = loadedAppliedIds.filter((id) => !accounted.has(id));

    let maxOccurredAt = 0;
    for (const e of history) {
      maxOccurredAt = Math.max(maxOccurredAt, e.occurredAt ?? 0);
    }
    for (const e of delivered) {
      maxOccurredAt = Math.max(maxOccurredAt, e.occurredAt ?? 0);
    }
    const isFrontierMissing =
      stateFrontierOccurredAtMs > 0 && maxOccurredAt < stateFrontierOccurredAtMs;

    if (missingAppliedIds.length === 0 && !isFrontierMissing) return null;
    return { missingAppliedIds, isFrontierMissing };
  }

  /**
   * Whether the projection cares about this event. An empty `eventTypes` list
   * means the projection subscribes to every event type.
   */
  private matchesEventTypes<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
  ): boolean {
    return projection.eventTypes.length === 0 || projection.eventTypes.includes(event.type);
  }

  private shouldRefoldOnMiss<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
  ): boolean {
    return (
      projection.options?.refoldOnStoreMiss === true && projection.eventLoaderUpTo !== undefined
    );
  }

  /** Whether this fold declares an absent store read authoritative. */
  private trustsAbsentMiss<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
  ): boolean {
    return projection.options?.trustAbsentMiss === true;
  }

  /**
   * Refuse folding onto init() when an undecodable row exists; refolding from
   * event_log is the only safe recovery. Without it, corruption (partial state
   * stamped at current version) becomes permanent and undetectable.
   */
  private assertUndecodableIsRecoverable<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    miss: "absent" | "undecodable" | undefined,
  ): void {
    if (miss !== "undecodable" || this.shouldRefoldOnMiss(projection)) return;
    throw new Error(
      `Fold projection "${projection.name}" read back a row it cannot decode and has no re-fold path ` +
        `(refoldOnStoreMiss=${String(projection.options?.refoldOnStoreMiss)}, ` +
        `eventLoaderUpTo=${projection.eventLoaderUpTo === undefined ? "unwired" : "wired"}). ` +
        `Refusing to fold onto an empty state, which would overwrite the committed row with a partial ` +
        `one stamped at the current version.`,
    );
  }

  /**
   * The second half of the undecodable guard: the rebuild must have produced
   * something. A null return is also corruption for undecodable misses.
   */
  private assertUndecodableWasRebuilt<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    miss: "absent" | "undecodable" | undefined,
  ): void {
    if (miss !== "undecodable") return;
    throw new Error(
      `Fold projection "${projection.name}" read back a row it cannot decode, and re-folding it from the event log ` +
        `produced no state (empty or unavailable history). Refusing to fold onto an empty state, which would ` +
        `overwrite the committed row with a partial one stamped at the current version.`,
    );
  }

  /**
   * Store-miss re-fold: rebuild from history up to the delivered event, then
   * apply any event the read missed. Returns null on empty history (init+apply).
   */
  private async refoldUpToDelivered<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    delivered: E[],
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    const upToEvent = delivered.reduce((latest, e) => {
      if (e.createdAt !== latest.createdAt) {
        return e.createdAt > latest.createdAt ? e : latest;
      }
      return e.id > latest.id ? e : latest;
    });

    // Stream the re-fold page-by-page when order-insensitive and a paginated loader is
    // wired, bounding memory for a huge aggregate (100k+ events). Gated on
    // refoldOnOutOfOrder: false since paged results arrive in (timestamp, eventId) order.
    if (projection.eventLoaderUpToPaged && projection.options?.refoldOnOutOfOrder === false) {
      return this.streamRefoldUpToDelivered({ projection, delivered, context, upToEvent });
    }

    const history = await projection.eventLoaderUpTo!({
      tenantId: context.tenantId,
      aggregateId: context.aggregateId,
      upToEvent,
    });
    if (history.length === 0) return null;

    logger.info(
      {
        projection: projection.name,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        deliveredCount: delivered.length,
        refoldEventCount: history.length,
      },
      "Store miss with refoldOnStoreMiss — re-folding from the event log",
    );

    // Merge delivered events the history read missed back into the fold's
    // declared order before folding — a tail append could let an event that
    // belongs in the middle overwrite last-write-wins fields.
    const seen = new Set(history.map((e) => e.id));
    const missing = delivered.filter((e) => !seen.has(e.id));
    const combined = [...(history as E[]), ...missing].toSorted((a, b) =>
      compareFoldEvents(projection, a, b),
    );
    let state = projection.init();
    for (const e of combined) {
      state = projection.apply(state, e);
    }
    return state;
  }

  /**
   * Streaming store-miss re-fold for order-insensitive folds: pages the
   * history, deduping across page boundaries. Bounded working set (one page)
   * vs unbounded array path; applies missing delivered events on top.
   */
  private async streamRefoldUpToDelivered<State, E extends Event>({
    projection,
    delivered,
    context,
    upToEvent,
  }: {
    projection: FoldProjectionDefinition<State, E>;
    delivered: E[];
    context: ProjectionStoreContext;
    upToEvent: E;
  }): Promise<State | null> {
    const PAGE_SIZE = this.refoldPageSize;
    // Safety net only: the paged loader's cursor is expected to strictly
    // advance every call. If that contract is ever violated (e.g. a
    // non-advancing cursor from a repository bug), this bounds the loop
    // instead of hanging the fold worker for the aggregate indefinitely.
    // 100k pages * 1000/page default covers a 100M-event aggregate.
    const MAX_PAGES = 100_000;
    const seen = new Set<string>();
    let state = projection.init();
    let after: { timestamp: number; eventId: string } | undefined;
    let refoldEventCount = 0;
    let pageCount = 0;

    for (;;) {
      if (++pageCount > MAX_PAGES) {
        throw new Error(
          `streamRefoldUpToDelivered exceeded ${MAX_PAGES} pages for aggregate ${context.aggregateId} — possible non-advancing cursor`,
        );
      }
      // Caller guards eventLoaderUpToPaged is set.
      const page = await projection.eventLoaderUpToPaged!({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        upToEvent,
        after,
        limit: PAGE_SIZE,
      });
      if (page.length === 0) break;

      const applied = applyUnseenEvents({ projection, events: page, seen, state });
      state = applied.state;
      refoldEventCount += applied.appliedCount;

      const last = page[page.length - 1]!;
      after = { timestamp: last.createdAt, eventId: last.id };
      if (page.length < PAGE_SIZE) break;
    }

    if (refoldEventCount === 0) return null;

    logger.info(
      {
        projection: projection.name,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        deliveredCount: delivered.length,
        refoldEventCount,
        streamed: true,
      },
      "Store miss with refoldOnStoreMiss — streamed re-fold from the event log",
    );

    for (const event of delivered) {
      const dedupKey = event.idempotencyKey || event.id;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      state = projection.apply(state, event);
    }

    return state;
  }
}
