import type { Event } from "../domain/types";
import type { ProjectionStoreContext } from "./projectionStoreContext";
import type {
  ProjectionCursor,
  StateProjectionDefinition,
  StoredProjection,
} from "./stateProjection.types";

/**
 * The canonical cursor of an event: the log-accept time (`createdAt`) with the
 * KSUID `id` as the same-millisecond tie-breaker. Shared with replay so a
 * rebuilt row carries an identical cursor to the live-folded one.
 */
export function cursorFor(event: Event): ProjectionCursor {
  return { acceptedAt: event.createdAt, eventId: event.id };
}

export function compareCursors(
  left: ProjectionCursor,
  right: ProjectionCursor,
): number {
  if (left.acceptedAt !== right.acceptedAt) {
    return left.acceptedAt - right.acceptedAt;
  }
  // BYTE-WISE tie-break, never localeCompare: KSUIDs are mixed-case base62 and
  // ClickHouse orders `EventId ASC` byte-wise — locale collation reorders case,
  // so a same-millisecond pair could pass the stale-guard in one order and be
  // read back in the other. Pinned against the shared @langwatch/langy
  // comparator by cursorContract.unit.test.ts.
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? -1 : 1;
}

export function orderEvents<E extends Event>(events: readonly E[]): E[] {
  return [...events].sort((left, right) =>
    compareCursors(cursorFor(left), cursorFor(right)),
  );
}

/**
 * Fold ONE event onto the running projection, returning the advanced
 * `StoredProjection` — or `latest` unchanged when the event's type does not
 * match or its cursor does not advance past `latest` (duplicate / stale
 * redelivery). Pure and deterministic: the timestamps are derived from the
 * event, never from wall-clock, so the live executor and a canonical replay
 * produce byte-identical rows. `latest === null` starts the fold from
 * `projection.init()`.
 *
 * Callers that feed a batch must pass events in canonical `(createdAt, id)`
 * order (see {@link orderEvents}); the cursor guard only tolerates
 * duplicates/staleness, it does not re-order.
 */
export function applyStateEvent<State, E extends Event>({
  projection,
  latest,
  event,
}: {
  projection: StateProjectionDefinition<State, E>;
  latest: StoredProjection<State> | null;
  event: E;
}): StoredProjection<State> | null {
  if (
    projection.eventTypes.length > 0 &&
    !projection.eventTypes.includes(event.type)
  ) {
    return latest;
  }
  const cursor = cursorFor(event);
  if (latest && compareCursors(cursor, latest.cursor) <= 0) return latest;

  const state = projection.apply(latest?.state ?? projection.init(), event);
  return {
    state,
    cursor,
    occurredAt: event.occurredAt,
    createdAt: latest?.createdAt ?? event.occurredAt,
    updatedAt: Math.max(latest?.updatedAt ?? 0, event.occurredAt),
    version: projection.version,
  };
}

/**
 * Applies queued events to a directly readable operational projection.
 *
 * GroupQueue serializes this executor per projection key. The persisted cursor
 * makes an acknowledged-after-write retry a no-op; no Redis cache, event-log
 * read, or database transaction is part of this load/apply/store cycle.
 */
export class StateProjectionExecutor {
  async execute<State, E extends Event>({
    projection,
    events,
    context,
  }: {
    projection: StateProjectionDefinition<State, E>;
    events: readonly E[];
    context: ProjectionStoreContext;
  }): Promise<StoredProjection<State> | null> {
    const matching = orderEvents(
      events.filter(
        (event) =>
          projection.eventTypes.length === 0 ||
          projection.eventTypes.includes(event.type),
      ),
    );
    if (matching.length === 0) return null;

    const key = context.key ?? context.aggregateId;
    const loaded = await projection.store.load(key, context);
    let latest = loaded;

    for (const event of matching) {
      latest = applyStateEvent({ projection, latest, event });
    }

    if (!latest || latest === loaded) return loaded;
    await projection.store.store(latest, context);
    return latest;
  }
}
