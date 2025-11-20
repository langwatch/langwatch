import type { EventStore as BaseEventStore, EventStoreReadContext } from "../library";
import type { SpanEvent } from "../types";

/**
 * Interface for storing and retrieving span events.
 */
export type EventStore = BaseEventStore<string, SpanEvent>;
export type EventStoreContext = EventStoreReadContext<string, SpanEvent>;
