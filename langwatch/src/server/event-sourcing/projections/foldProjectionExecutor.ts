import { createLogger } from "@langwatch/observability";
import { incrementEsFoldRefoldTotal } from "~/server/metrics";
import type { Event } from "../domain/types";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:fold-executor");

/**
 * Whether an out-of-order event should replay the aggregate's history rather
 * than being applied on top of the state already loaded.
 *
 * See `FoldProjectionOptions.refoldOnOutOfOrder` for why an order-insensitive
 * fold must opt out. Either way the caller still applies the events in
 * occurredAt order, so declining costs nothing but the replay.
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
 * Returns a context carrying the event's occurredAt as a store read hint, or
 * the original context unchanged when the event has no usable occurredAt.
 */
function withOccurredAtHint(
  context: ProjectionStoreContext,
  event: Event,
): ProjectionStoreContext {
  const occurredAt = (event as Record<string, unknown>).occurredAt;
  if (typeof occurredAt !== "number" || occurredAt <= 0) return context;
  return { ...context, occurredAtMs: occurredAt };
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
 * Out-of-order detection: compares event.occurredAt against the state's
 * LastEventOccurredAt (tracked by AbstractFoldProjection). If the event
 * occurred earlier than what we've already seen, all events are re-loaded
 * in occurredAt order and replayed from init() — unless the projection set
 * `options.refoldOnOutOfOrder` to false (see {@link canRefold}).
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
   * @param refoldPageSize events per page for the streaming store-miss re-fold
   *   (`streamRefoldUpToDelivered`). Bounds the working set; 1000 keeps the
   *   per-page memory small while amortising the per-query round-trip. Injected
   *   only so tests can force multi-page runs.
   */
  constructor(private readonly refoldPageSize = 1000) {}

  async execute<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
    context: ProjectionStoreContext,
  ): Promise<State> {
    if (!this.matchesEventTypes(projection, event)) {
      return projection.init();
    }

    const key = context.key ?? context.aggregateId;
    // Pass the event's occurredAt so a time-partitioned store (e.g. the trace
    // summary store) can prune its backing-table read to a window around this
    // time instead of scanning every partition. Best-effort: the store falls
    // back to an unbounded read when the hint misses.
    const loadContext = withOccurredAtHint(context, event);
    const loaded = await projection.store.get(key, loadContext);

    if (loaded === null && this.shouldRefoldOnMiss(projection)) {
      const refolded = await this.refoldUpToDelivered(
        projection,
        [event],
        context,
      );
      if (refolded !== null) {
        await projection.store.store(refolded, context);
        return refolded;
      }
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
      typeof eventOccurredAt === "number" &&
      eventOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      eventOccurredAt < prevLastOccurred &&
      canRefold(projection, context)
    ) {
      // biome-ignore lint/style/noNonNullAssertion: canRefold returns false without an eventLoader.
      const allEvents = await projection.eventLoader!({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs: eventOccurredAt,
      });

      logger.info(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          eventType: event.type,
          eventOccurredAt,
          prevLastOccurred,
          refoldEventCount: allEvents.length,
        },
        "Out-of-order event detected, re-folding from scratch",
      );

      state = projection.init();
      for (const e of allEvents) {
        state = projection.apply(state, e as E);
      }
    }

    await projection.store.store(state, context);
    return state;
  }

  /**
   * Applies a batch of events for the same aggregate in a single load/store cycle.
   *
   * Equivalent to calling `execute()` once per event, but reads the existing
   * state once, folds every event in occurredAt order, and writes the result
   * once. This turns a backed-up group of N events from N load+store round-trips
   * (O(n²) on growing fold state) into a single one (O(n)).
   *
   * Out-of-order handling matches `execute()`: if the earliest event in the
   * batch occurred before the persisted checkpoint, the aggregate is re-folded
   * from scratch via `eventLoader` — when one exists and the projection has not
   * opted out via `options.refoldOnOutOfOrder` (see {@link canRefold}).
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

    // Process in occurredAt order so the fold sees events as they happened,
    // regardless of the order they were dispatched/drained in.
    const ordered = [...matching].sort(
      (a, b) =>
        (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
        (((b as Record<string, unknown>).occurredAt as number) ?? 0),
    );

    const key = context.key ?? context.aggregateId;
    // Hint the store with one event's occurredAt (any event in the batch is for
    // the same aggregate, so it anchors the same partition window).
    const loadContext = ordered[0]
      ? withOccurredAtHint(context, ordered[0])
      : context;
    const loaded = await projection.store.get(key, loadContext);

    if (loaded === null && this.shouldRefoldOnMiss(projection)) {
      const refolded = await this.refoldUpToDelivered(
        projection,
        ordered,
        context,
      );
      if (refolded !== null) {
        await projection.store.store(refolded, context);
        return refolded;
      }
    }

    const loadedState = loaded ?? projection.init();

    const prevLastOccurred =
      (loadedState as Record<string, unknown>)[
        projection.LastEventOccurredAtKey
      ] ?? 0;
    const earliestOccurredAt = (ordered[0] as Record<string, unknown>)
      .occurredAt;

    // Out-of-order vs the persisted checkpoint: the batch starts earlier than
    // what we've already folded. Re-fold from scratch when we can load the full
    // history AND the projection still gains something by replaying it;
    // otherwise apply the batch on top (matches the single-event executor's
    // degraded behavior when no eventLoader exists).
    const isOutOfOrder =
      typeof earliestOccurredAt === "number" &&
      earliestOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      earliestOccurredAt < prevLastOccurred;

    let state = loadedState;
    if (isOutOfOrder && canRefold(projection, context)) {
      // biome-ignore lint/style/noNonNullAssertion: canRefold returns false without an eventLoader.
      const allEvents = await projection.eventLoader!({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs: earliestOccurredAt,
      });
      logger.info(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          batchSize: ordered.length,
          earliestOccurredAt,
          prevLastOccurred,
          refoldEventCount: allEvents.length,
        },
        "Out-of-order batch detected, re-folding from scratch",
      );
      state = projection.init();
      for (const e of allEvents) {
        state = projection.apply(state, e as E);
      }
    } else {
      for (const event of ordered) {
        state = projection.apply(state, event);
      }
    }

    await projection.store.store(state, context);
    return state;
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

    // Merge delivered events the history read missed back into occurredAt
    // order before folding — a tail-append would let an event that belongs in
    // the middle of the history overwrite last-write-wins fields. Stable sort
    // keeps arrival order for equal occurredAt, same as executeBatch.
    const seen = new Set(history.map((e) => e.id));
    const missing = delivered.filter((e) => !seen.has(e.id));
    const combined = [...(history as E[]), ...missing].sort(
      (a, b) =>
        (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
        (((b as Record<string, unknown>).occurredAt as number) ?? 0),
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
      // biome-ignore lint/style/noNonNullAssertion: caller guards eventLoaderUpToPaged is set.
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
