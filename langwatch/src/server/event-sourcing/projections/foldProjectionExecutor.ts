import { createLogger } from "~/utils/logger/server";
import type { Event } from "../domain/types";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:fold-executor");

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
 * 4. If out-of-order detected and `eventLoader` available → re-fold from scratch
 * 5. `projection.store.store(state, context)`
 *
 * Out-of-order detection: compares event.occurredAt against the state's
 * LastEventOccurredAt (tracked by AbstractFoldProjection). If the event
 * occurred earlier than what we've already seen, all events are re-loaded
 * in occurredAt order and replayed from init().
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

    let state = loaded ?? projection.init();

    // Capture the highest occurredAt before applying the new event.
    const prevLastOccurred =
      (state as Record<string, unknown>)[projection.LastEventOccurredAtKey] ??
      0;

    state = projection.apply(state, event);

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
      eventOccurredAt < prevLastOccurred
    ) {
      if (!projection.eventLoader) {
        logger.warn(
          { projection: projection.name, aggregateId: context.aggregateId },
          "Out-of-order event detected but no eventLoader available — cannot re-fold",
        );
        await projection.store.store(state, context);
        return state;
      }
      const allEvents = await projection.eventLoader({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs:
          typeof eventOccurredAt === "number" ? eventOccurredAt : undefined,
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
   * from scratch via `eventLoader` (when available).
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

    let state = loaded ?? projection.init();

    const prevLastOccurred =
      (state as Record<string, unknown>)[projection.LastEventOccurredAtKey] ??
      0;
    const earliestOccurredAt = (ordered[0] as Record<string, unknown>)
      .occurredAt;

    // Out-of-order vs the persisted checkpoint: the batch starts earlier than
    // what we've already folded. Re-fold from scratch when we can load the full
    // history; otherwise fall through and apply the batch on top (matches the
    // single-event executor's degraded behavior when no eventLoader exists).
    const outOfOrder =
      typeof earliestOccurredAt === "number" &&
      earliestOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      earliestOccurredAt < prevLastOccurred;

    if (outOfOrder && projection.eventLoader) {
      const allEvents = await projection.eventLoader({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs:
          typeof earliestOccurredAt === "number"
            ? earliestOccurredAt
            : undefined,
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
      if (outOfOrder) {
        logger.warn(
          { projection: projection.name, aggregateId: context.aggregateId },
          "Out-of-order batch detected but no eventLoader available — cannot re-fold",
        );
      }
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
}
