import type { Event } from "../domain/types.ts";
import type { DeduplicationConfig } from "../queues/queue.types.ts";
import type { ExecutionTarget } from "../runtime.types.ts";

/**
 * INTERNAL dispatch-plane context for a subscriber's handle function.
 * Authoring code uses `TriggerContext`; this is the shape the router and
 * queue pass beneath that sugar.
 */
export interface SubscriberDispatchContext<FoldState = unknown> {
  tenantId: string;
  aggregateId: string;
  foldState: FoldState;
  /**
   * True when the event was produced by a stream replay rather than live
   * ingestion. The replay service never dispatches subscribers, so today this
   * is always `false` where a handler sees it.
   */
  isReplay?: boolean;
}

/**
 * Options for configuring a subscriber.
 */
export interface SubscriberDispatchOptions {
  disabled?: boolean;
  /** Delay in milliseconds before the subscriber fires */
  delay?: number;
  /** Deduplication TTL in milliseconds. Only used if makeJobId is provided. */
  ttl?: number;
  /** Deduplication strategy — function that returns a unique job ID for the payload */
  makeJobId?: (payload: { event: Event; foldState: unknown }) => string;
  /** Full GroupQueue dedup contract used by pipeline subscribers. */
  deduplication?: DeduplicationConfig<{
    event: Event;
    foldState: unknown;
  }>;
  /** Process roles where this subscriber runs. Omit to run everywhere. */
  runIn?: ExecutionTarget[];
  /** Custom queue routing key function; overrides the domain part of hierarchical key. */
  groupKeyFn?: (payload: { event: Event; foldState: unknown }) => string;
}

/**
 * A post-fold side-effect handler: fires only after its fold applies and
 * stores. Dedup is opt-in via `deduplication` and `makeJobId`+`ttl`, pointed
 * at one key function so they cannot drift. See `REACTIONS.md`.
 */
export interface SubscriberDispatchDefinition<E extends Event = Event, FoldState = unknown> {
  /** Unique name for this subscriber */
  name: string;
  /**
   * Must be pure and synchronous: runs on the projection hot path, and a
   * throw is caught and treated as true so a side effect is never dropped.
   * Guards needing dependencies belong in handle().
   */
  shouldDispatch?(event: E, context: SubscriberDispatchContext<FoldState>): boolean;
  /** Side-effect handler called after fold succeeds */
  handle: (event: E, context: SubscriberDispatchContext<FoldState>) => Promise<void>;
  /** Optional configuration */
  options?: SubscriberDispatchOptions;
}
