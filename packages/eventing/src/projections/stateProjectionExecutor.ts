import type { Event } from "../domain/types.ts";
import { compareOrdinal } from "../utils/compareOrdinal.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";
import type {
  ProjectionCursor,
  StateProjectionDefinition,
  StoredProjection,
} from "./stateProjection.types.ts";

/**
 * The canonical cursor of an event: the log-accept time (`createdAt`) with the
 * KSUID `id` as the same-millisecond tie-breaker. Shared with replay so a
 * rebuilt row carries an identical cursor to the live-folded one.
 */
export function cursorFor(event: Event): ProjectionCursor {
  return { acceptedAt: event.createdAt, eventId: event.id };
}

export function compareCursors(left: ProjectionCursor, right: ProjectionCursor): number {
  if (left.acceptedAt !== right.acceptedAt) {
    return left.acceptedAt - right.acceptedAt;
  }
  return compareOrdinal(left.eventId, right.eventId);
}

export function orderEvents<E extends Event>(events: readonly E[]): E[] {
  return [...events].toSorted((left, right) => compareCursors(cursorFor(left), cursorFor(right)));
}

/** Fold one event onto the projection, returning the new StoredProjection or latest unchanged. */
export function applyStateEvent<State, E extends Event>({
  projection,
  latest,
  event,
}: {
  projection: StateProjectionDefinition<State, E>;
  latest: StoredProjection<State> | null;
  event: E;
}): StoredProjection<State> | null {
  if (projection.eventTypes.length > 0 && !projection.eventTypes.includes(event.type)) {
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
 * GroupQueue serializes this executor per projection key; the persisted
 * cursor makes an acknowledged-after-write retry a safe no-op.
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
        (event) => projection.eventTypes.length === 0 || projection.eventTypes.includes(event.type),
      ),
    );
    if (matching.length === 0) return null;

    const key = context.key ?? context.aggregateId;
    const read = await projection.store.get(key, context);
    const loaded = read.kind === "folded" ? read.projection : null;
    let latest = loaded;

    for (const event of matching) {
      latest = applyStateEvent({ projection, latest, event });
    }

    if (!latest || latest === loaded) return loaded;
    await projection.store.store(latest, context);
    return latest;
  }
}
