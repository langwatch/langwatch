import { createLogger } from "@langwatch/observability";
import {
  incrementEsFoldAbsentMissTrustedTotal,
  incrementEsFoldDuplicateEventsSkipped,
  incrementEsFoldReadWindowFallbackTotal,
  incrementEsFoldRefoldOnMissTotal,
  incrementEsFoldRefoldTotal,
  observeEsFoldBlindReapplyEvents,
} from "~/server/metrics";
import type { Event } from "../domain/types";
import { mergeAppliedEventIds } from "./foldCache/foldCacheEntry";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import {
  type ProjectionStoreContext,
  readWindowAround,
} from "./projectionStoreContext";

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
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
 * Whether an out-of-order event should replay the aggregate's history rather
 * than being applied on top of the state already loaded.
 *
 * See `FoldProjectionOptions.refoldOnOutOfOrder` for why an order-insensitive
 * business-time fold may opt out. Accepted-order folds never enter this path.
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
 * Returns a context carrying the event's occurredAt — and, when the fold
 * DECLARED a read window (`options.readWindow`), the computed
 * `occurredAt ± widthMs` bound for the store's backing read. The original
 * context is returned unchanged when the event has no usable occurredAt: an
 * unusable business time cannot anchor a window, so the read stays unbounded.
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

/**
 * Executes a fold projection incrementally by applying a single event to existing state.
 *
 * Flow:
 * 1. Load existing state via `store.get()` (or `init()` if none)
 * 2. If the store missed and `options.refoldOnStoreMiss` is set → re-fold
 *    from the event log up to the delivered event (see below)
 * 3. `state = projection.apply(state, event)`
 * 4. If out-of-order detected and the projection admits a re-fold → re-fold from scratch
 * 5. `projection.store.store(state, context)`
 *
 * For business-time folds, out-of-order detection compares event.occurredAt
 * against the state's LastEventOccurredAt (tracked by
 * AbstractFoldProjection). If the event occurred earlier than what we've
 * already seen, all events are re-loaded in occurredAt order and replayed
 * from init() — unless the projection set `options.refoldOnOutOfOrder` to
 * false (see {@link canRefold}). Accepted-order folds rely on their serialized
 * queue lane and do not business-time re-fold a backdated event.
 *
 * Store-miss re-fold (`options.refoldOnStoreMiss`): a fold whose persisted
 * row cannot be read back into fold state (lossy analytics rows) returns
 * null from `store.get()` whenever its cache is cold. Starting from `init()`
 * there would fold only the delivered events — a partial state that
 * overwrites the complete row. Instead, the aggregate's history is loaded
 * up to AND INCLUDING the delivered event in log order (`eventLoaderUpTo`)
 * and folded from scratch. The log-order bound guarantees an event that is
 * persisted but still queued for this projection is NOT pre-applied (its own
 * delivery is next). If the delivered event is missing from the loaded
 * history (event-log read lag), it is applied on top.
 */
export class FoldProjectionExecutor {
  /**
   * Events per page for the streaming store-miss re-fold
   * (`streamRefoldUpToDelivered`). Bounds the working set; 1000 keeps the
   * per-page memory small while amortising the per-query round-trip. Injected
   * only so tests can force multi-page runs.
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

  /**
   * Loads state along with the ids of the events already folded into it.
   *
   * A store that keeps an applied-event-id set — the Redis cache wrapper, or a
   * store that persists the set durably next to its row — answers with it via
   * `getWithApplied`. A store that keeps none has no `getWithApplied`; its read
   * carries an empty set and the executor treats every delivery as fresh.
   *
   * When the fold declared a read window and the windowed read misses, the
   * read is retried ONCE without the window: the row may sit outside the
   * window (long-lived aggregate, clock skew, backfill), and concluding "new
   * aggregate" from a windowed miss is how a partial batch folded onto
   * `init()` permanently overwrites the complete row. The retry is the
   * declared-window contract's correctness net; the windowed read is only the
   * partition-pruning fast path.
   *
   * A fold that declared `trustAbsentMiss` has replaced that net with a
   * stronger claim — its store always writes a row and its window provably
   * covers every live one — so for it an absent windowed read IS the answer
   * and the retry is skipped (see the option's docstring for the measured
   * basis and the `HasSignal` prerequisite). An `undecodable` miss is outside
   * the claim and keeps its own no-retry reasoning below.
   */
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
        return await store.getWithApplied(key, readContext);
      }
      // A get()-only store has no way to say "found but refused", so its null
      // is always an absent miss; stamping it keeps the miss kind uniform for
      // the refold gate and `trustAbsentMiss` downstream.
      const state = await store.get(key, readContext);
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
   * The applied-event-id set to record at commit.
   *
   * On a fresh delivery the previous batch for this group already acked (the
   * queue holds one active batch per group), so its ids can never be
   * redelivered — the set resets to this batch's fresh ids, staying bounded to
   * one batch. On a RETRY it must instead be the UNION of the set loaded at read
   * time and the fresh ids: a retry chain that keeps losing its cache would
   * otherwise record only each attempt's fresh ids, and a later attempt
   * redelivering the whole batch would re-apply the events an earlier attempt
   * already folded into the durable row (silent double-count). Merging keeps
   * every id the durable row still needs to recognise, capped and deduped.
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
    // Replace ONLY on the first commit of a fresh delivery — that is the
    // garbage collection that keeps the applied set bounded at one delivery's
    // ids instead of growing forever. Everything else extends:
    // - a retry (attempt > 1) must keep what earlier attempts recorded, or the
    //   redelivery re-applies it;
    // - a continuation (a later sub-batch of the same locked dispatch, from
    //   batch bisection) must keep what the earlier sub-batches recorded — each
    //   commit only carries its own sub-batch's ids, and replacing would erase
    //   the rest of the chain, so a redelivery after a failed later sub-batch
    //   would double-apply the committed prefix (#6578).
    const isRetry = (context.deliveryAttempt ?? 1) > 1;
    return isRetry || context.isDeliveryContinuation
      ? mergeAppliedEventIds({
          previous: loadedAppliedIds,
          applied: deliveredIds,
        })
      : [...deliveredIds];
  }

  /**
   * Drops events already folded into the loaded state.
   *
   * Queue delivery is at-least-once: a fold job that fails after its state was
   * stored is re-dispatched with the same events. Most handlers accumulate
   * (counters, sums, appends) rather than being idempotent, so re-applying
   * would double-count silently.
   */
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

    // A trusted absent miss folds from init() WITHOUT replaying event_log:
    // the store always writes a row (see trustAbsentMiss's docstring), so no row
    // means nothing was ever committed and there is no history worth reading
    // — the measured steady state was 93% of these re-folds returning exactly
    // the delivered batch. `undecodable` deliberately does not take this
    // shortcut: there a complete row EXISTS and the re-fold is what makes
    // refusing it safe.
    const absentTrusted =
      loaded === null && miss === "absent" && this.trustsAbsentMiss(projection);
    if (absentTrusted && this.shouldRefoldOnMiss(projection)) {
      incrementEsFoldAbsentMissTrustedTotal(projection.name, "refold");
    }

    if (
      loaded === null &&
      !absentTrusted &&
      this.shouldRefoldOnMiss(projection)
    ) {
      const refolded = await this.refoldUpToDelivered(
        projection,
        [event],
        context,
      );
      // The ADR-066 transitional net, made observable: its deletion condition is
      // "it stopped firing", which is otherwise indistinguishable from a
      // regression to the pre-ADR-066 steady state of refolding on every miss.
      incrementEsFoldRefoldOnMissTotal(
        projection.name,
        refolded === null ? "absent" : "performed",
      );
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
        return refolded;
      }
      this.assertUndecodableWasRebuilt(projection, miss);
    }

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
      (loadedState as Record<string, unknown>)[
        projection.LastEventOccurredAtKey
      ] ?? 0;

    let state = projection.apply(loadedState, event);

    // Detect out-of-order: event's occurredAt is STRICTLY LESS than what we've already seen.
    // Same occurredAt (==) does NOT trigger re-fold — arrival order is the correct
    // tiebreaker for events at the same logical instant (e.g., SDK sends snapshot and
    // finished with identical occurredAt). The +1 on UpdatedAt in apply() guarantees
    // distinct ClickHouse rows regardless.
    const eventOccurredAt = (event as Record<string, unknown>).occurredAt;
    if (
      projection.options?.eventOrdering !== "acceptedAt" &&
      typeof eventOccurredAt === "number" &&
      eventOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      eventOccurredAt < prevLastOccurred &&
      canRefold(projection, context)
    ) {
      // CanRefold returns false without an eventLoader.
      const refolded = await this.refoldWithDelivered({
        projection,
        delivered: [event],
        context,
        occurredAtMs: eventOccurredAt,
        loadedAppliedIds: appliedEventIds,
        stateFrontierOccurredAtMs: prevLastOccurred,
        logFields: { eventType: event.type, eventOccurredAt, prevLastOccurred },
        message: "Out-of-order event detected, re-folding from scratch",
      });
      // An incomplete history read returns null: the loaded state stays the
      // base and the event stays applied on top, out of order but not lost.
      if (refolded !== null) state = refolded;
    }

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
   * Applies a batch of events for the same aggregate in a single load/store cycle.
   *
   * Equivalent to calling `execute()` once per event, but reads the existing
   * state once, folds every event in the projection's declared order, and
   * writes the result once. This turns a backed-up group of N events from N
   * load+store round-trips (O(n²) on growing fold state) into a single one
   * (O(n)).
   *
   * Business-time out-of-order handling matches `execute()`: if the earliest
   * event in the batch occurred before the persisted checkpoint, the aggregate
   * is re-folded from scratch via `eventLoader` — when one exists and the
   * projection has not opted out via `options.refoldOnOutOfOrder` (see
   * {@link canRefold}).
   */
  async executeBatch<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    events: E[],
    context: ProjectionStoreContext,
  ): Promise<State> {
    const matching = events.filter((event) =>
      this.matchesEventTypes(projection, event),
    );
    if (matching.length === 0) {
      return projection.init();
    }
    if (matching.length === 1) {
      return this.execute(projection, matching[0]!, context);
    }

    // Most folds follow business time. Lifecycle folds may instead select the
    // canonical accepted cursor so a backdated transition cannot jump ahead of
    // an event the log accepted first.
    const ordered = [...matching].sort((a, b) =>
      compareFoldEvents(projection, a, b),
    );

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
    const absentTrusted =
      loaded === null && miss === "absent" && this.trustsAbsentMiss(projection);
    if (absentTrusted && this.shouldRefoldOnMiss(projection)) {
      incrementEsFoldAbsentMissTrustedTotal(projection.name, "refold");
    }

    if (
      loaded === null &&
      !absentTrusted &&
      this.shouldRefoldOnMiss(projection)
    ) {
      const refolded = await this.refoldUpToDelivered(
        projection,
        ordered,
        context,
      );
      // Counted as on the single-event path above.
      incrementEsFoldRefoldOnMissTotal(
        projection.name,
        refolded === null ? "absent" : "performed",
      );
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
      (loadedState as Record<string, unknown>)[
        projection.LastEventOccurredAtKey
      ] ?? 0;
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
        stateFrontierOccurredAtMs:
          typeof prevLastOccurred === "number" ? prevLastOccurred : 0,
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
   * Out-of-order re-fold: replays the aggregate's history from the event log
   * with the delivered events merged back in when the read did not return
   * them.
   *
   * The read runs moments after the delivered event was appended, and on a
   * replicated event log it can come back without it (the store-miss re-fold
   * guards the same lag, see `refoldUpToDelivered`). Replaying that history
   * alone commits a state without the delivered event while its id is
   * recorded as applied, so the event is never folded again. A simulation
   * run's `finished` event lost that race to the `agent_instance_recorded`
   * event stamped 63 ms after it, and the run read IN_PROGRESS forever.
   *
   * The same lag can also hide an event ALREADY folded into the loaded
   * state, and a replay from that read would silently drop it. Two fences
   * catch an incomplete read before it can replace the state:
   *
   * - every applied id the state was loaded with must be in the read or in
   *   the delivery (the applied set is exactly the most recent commit, the
   *   events most exposed to read lag);
   * - the read plus the delivery must reach the state's occurred-at
   *   checkpoint (a state at checkpoint T absorbed an event at T, so a
   *   complete read returns one).
   *
   * A read that fails a fence is re-read on a short backoff; if it still
   * fails, this returns null and the caller keeps the loaded state, applying
   * the delivery on top, out of order but with nothing thrown away.
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
          missingAppliedIds: gap.missingAppliedIds.slice(
            0,
            MAX_LOGGED_EVENT_IDS,
          ),
          isFrontierMissing: gap.isFrontierMissing,
          stateFrontierOccurredAtMs,
        },
        "Re-fold history read stayed incomplete after retries; keeping the loaded state and applying the delivery on top",
      );
      return null;
    }

    const seen = new Set(history.map((e) => e.id));
    const missing = delivered.filter((e) => !seen.has(e.id));
    const combined = [...(history as E[]), ...missing].sort((a, b) =>
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
          missingEventIds: missing
            .map((e) => e.id)
            .slice(0, MAX_LOGGED_EVENT_IDS),
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
   * Reads the aggregate's history, and re-reads it on a short backoff while a
   * fence still reports a gap (see `historyReadGap`). Returns the last read
   * with the gap that stands after the retries, null once the read accounts
   * for everything the loaded state already holds.
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
   * What a history read is missing before it may replace the loaded state:
   * applied ids of the previous commit that neither the read nor the delivery
   * accounts for, and the state's occurred-at checkpoint when nothing in
   * either reaches it. Null when the read is complete enough to replay.
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
    const missingAppliedIds = loadedAppliedIds.filter(
      (id) => !accounted.has(id),
    );

    let maxOccurredAt = 0;
    for (const e of history) {
      maxOccurredAt = Math.max(maxOccurredAt, e.occurredAt ?? 0);
    }
    for (const e of delivered) {
      maxOccurredAt = Math.max(maxOccurredAt, e.occurredAt ?? 0);
    }
    const isFrontierMissing =
      stateFrontierOccurredAtMs > 0 &&
      maxOccurredAt < stateFrontierOccurredAtMs;

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
    return (
      projection.eventTypes.length === 0 ||
      projection.eventTypes.includes(event.type)
    );
  }

  private shouldRefoldOnMiss<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
  ): boolean {
    return (
      projection.options?.refoldOnStoreMiss === true &&
      projection.eventLoaderUpTo !== undefined
    );
  }

  /**
   * Whether this fold declared an absent store read authoritative — see
   * `FoldProjectionOptions.trustAbsentMiss` for the two-part claim that
   * declaration makes. `ES_FOLD_TRUST_ABSENT_MISS=0` is the operational
   * kill-switch: it restores the unwindowed fallback read and the store-miss
   * re-fold for every fold at once, without a code change, read per call so
   * flipping it needs no restart of anything that re-reads env (and a plain
   * string compare costs nothing at these rates).
   */
  private trustsAbsentMiss<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
  ): boolean {
    if (projection.options?.trustAbsentMiss !== true) return false;
    const env = process.env.ES_FOLD_TRUST_ABSENT_MISS;
    return env !== "0" && env !== "false";
  }

  /**
   * Refuse to fold onto `init()` when the store FOUND a row and rejected it.
   *
   * `absent` and `undecodable` are both "no state", but they must not be
   * handled alike. An absent row means this batch is the aggregate's first, so
   * folding from `init()` is exactly right. An undecodable row means a complete
   * state exists and this build cannot read it — folding from `init()` would
   * write a PARTIAL state stamped at the CURRENT version, which the gate that
   * just rejected the row would then accept forever. The corruption launders
   * itself and the original is gone.
   *
   * Refolding from `event_log` is what makes a rejection safe, so without it
   * the only correct move is to stop. Throwing puts the job on its retry
   * budget and surfaces to an operator; the alternative is silent, permanent,
   * and undetectable after the fact.
   *
   * This pairing is easy to break from a distance: `refoldOnStoreMiss` is
   * documented for deletion once its population ages out, and `eventLoaderUpTo`
   * is auto-wired only when the service has an event store.
   *
   * This proves only that a rebuild is POSSIBLE, not that it happened — the
   * refold can still come back empty. {@link assertUndecodableWasRebuilt}
   * closes that half, and both are needed.
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
   * The second half of the undecodable guard: the rebuild must have PRODUCED
   * something.
   *
   * `refoldUpToDelivered` returns null when the aggregate's history reads back
   * empty — a truncated log, a retention sweep, an event store that answered
   * nothing. For an `absent` miss that is ordinary and folding from `init()` is
   * right. For an `undecodable` one it is the corruption case again by another
   * route: a complete row exists, this build cannot read it, and the rebuild
   * that was supposed to make refusing it safe came back with nothing. Falling
   * through would commit a partial state at the current version and launder it
   * past the gate exactly as if no refold had been configured at all.
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
   * Store-miss re-fold: rebuild state from the aggregate's event history up
   * to AND INCLUDING the log-latest delivered event, then apply any delivered
   * event the history read did not return (event-log read lag on the
   * just-persisted event).
   *
   * Returns null when the history read comes back empty — the caller falls
   * through to the plain init+apply path, which is equivalent for a genuinely
   * new aggregate. A failed history read propagates: correctness over
   * availability, the queue's retry machinery re-delivers.
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

    // Stream the re-fold page-by-page when the fold is order-insensitive and a
    // paginated loader is wired. Bounds memory for a huge aggregate (a hot
    // trace's 100k+ events never land in memory whole). Gated on
    // refoldOnOutOfOrder: false because pages arrive in (timestamp, eventId)
    // order, not occurredAt order — equivalent only for an order-insensitive
    // fold.
    if (
      projection.eventLoaderUpToPaged &&
      projection.options?.refoldOnOutOfOrder === false
    ) {
      return this.streamRefoldUpToDelivered(
        projection,
        delivered,
        context,
        upToEvent,
      );
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
    const combined = [...(history as E[]), ...missing].sort((a, b) =>
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
   * aggregate's history via `eventLoaderUpToPaged`, folding each page and
   * discarding it. At most one page of events (plus the fold state and a set of
   * seen dedup keys) is held at once — the difference between a bounded working
   * set and OOMing on a 100k-event aggregate, where the array path's single
   * unbounded read materialises every EventPayload blob simultaneously.
   *
   * Parity with the array `refoldUpToDelivered`:
   * - Dedup: the store returns each page raw (undeduplicated), so the last
   *   row always matches what was actually read and the cursor never stalls.
   *   This `seen` set (idempotencyKey ?? id) does the deduplication instead,
   *   reproducing `deduplicateEvents`'s effect across page boundaries — which
   *   the strict `>` cursor alone cannot (a retry can share an idempotencyKey
   *   under a different EventId).
   * - Order: immaterial — this path is gated on `refoldOnOutOfOrder: false`.
   * - Missing delivered: any delivered event the history read did not return
   *   (event-log read lag) is applied on top, as the array path does.
   */
  private async streamRefoldUpToDelivered<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    delivered: E[],
    context: ProjectionStoreContext,
    upToEvent: E,
  ): Promise<State | null> {
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

      for (const event of page) {
        const dedupKey = event.idempotencyKey || event.id;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        state = projection.apply(state, event as E);
        refoldEventCount++;
      }

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
