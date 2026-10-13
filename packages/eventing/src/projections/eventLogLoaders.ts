import type { AggregateType } from "../domain/aggregateType.ts";
import { createTenantId } from "../domain/tenantId.ts";
import type { Event } from "../domain/types.ts";
import type { EventStore } from "../stores/eventStore.types.ts";
import type { FoldProjectionDefinition } from "./foldProjection.types.ts";
import type { MapProjectionDefinition } from "./mapProjection.types.ts";

/** One aggregate type's history in the event log: what a fold re-folds and a map dedupes from. */
export interface AggregateEventLog<Stored extends Event = Event> {
  readonly aggregateType: AggregateType;
  readonly eventStore: EventStore<Stored>;
}

/**
 * Wires a fold's history loaders (out-of-order re-fold, store-miss re-fold and its paged
 * variant) over one aggregate type's event log, leaving any loader the fold already carries.
 */
export function wireFoldEventLoaders<Stored extends Event>({
  fold,
  log: { aggregateType, eventStore },
}: {
  fold: Pick<
    FoldProjectionDefinition<unknown>,
    "eventLoader" | "eventLoaderUpTo" | "eventLoaderUpToPaged"
  >;
  log: AggregateEventLog<Stored>;
}): void {
  fold.eventLoader ??= async (ctx) => {
    const events = await eventStore.getEvents({
      aggregateId: ctx.aggregateId,
      context: { tenantId: createTenantId(ctx.tenantId) },
      aggregateType,
      anchorOccurredAtMs: ctx.occurredAtMs,
    });
    return [...events].toSorted((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
  };
  // History up to AND including the delivered event in log order, so a store-miss re-fold
  // never pre-applies an event persisted but still queued (per-aggregate FIFO delivers it next).
  fold.eventLoaderUpTo ??= loadUpTo({ aggregateType, eventStore });
  // One (timestamp, eventId)-ordered page; no occurredAt re-sort, as the streaming path
  // serves order-insensitive folds only.
  const getEventsUpToPaged = eventStore.getEventsUpToPaged?.bind(eventStore);
  if (!fold.eventLoaderUpToPaged && getEventsUpToPaged) {
    fold.eventLoaderUpToPaged = async (ctx) => [
      ...(await getEventsUpToPaged({
        aggregateId: ctx.aggregateId,
        context: { tenantId: createTenantId(ctx.tenantId) },
        aggregateType,
        upToEvent: ctx.upToEvent as Stored,
        after: ctx.after,
        limit: ctx.limit,
      })),
    ];
  }
}

/** Wires a map's log-ordered history loader for `options.dedupeByIdempotencyKey`. */
export function wireMapEventLoader<Stored extends Event>({
  map,
  log,
}: {
  map: Pick<MapProjectionDefinition<unknown>, "eventLoaderUpTo">;
  log: AggregateEventLog<Stored>;
}): void {
  map.eventLoaderUpTo ??= loadUpTo(log);
}

function loadUpTo<Stored extends Event>({
  aggregateType,
  eventStore,
}: AggregateEventLog<Stored>): (ctx: {
  tenantId: string;
  aggregateId: string;
  upToEvent: Event;
}) => Promise<Event[]> {
  return async (ctx) => {
    const events = await eventStore.getEventsUpTo({
      aggregateId: ctx.aggregateId,
      context: { tenantId: createTenantId(ctx.tenantId) },
      aggregateType,
      upToEvent: ctx.upToEvent as Stored,
    });
    return [...events].toSorted((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
  };
}
