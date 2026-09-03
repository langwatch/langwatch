import type { Event } from "../domain/types";
import type { DeduplicationConfig } from "../queues/queue.types";
import type { ExecutionTarget } from "../runtime.types";

/**
 * INTERNAL dispatch-plane context for a subscriber registration's handle
 * function. Authoring code uses `TriggerContext` via pipeline subscriber and
 * process-manager definitions; this shape is what the router and queue
 * pass beneath that sugar.
 */
export interface SubscriberDispatchContext<FoldState = unknown> {
  tenantId: string;
  aggregateId: string;
  foldState: FoldState;
  /**
   * True when the event was produced by a stream replay rather than live
   * ingestion. Framework call sites always pass a defined value (live events
   * get `false`); the replay service never dispatches subscribers, so today
   * this is always `false` where a handler sees it.
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
  /** Custom group key function for queue routing. Overrides the domain part of the hierarchical key. */
  groupKeyFn?: (payload: { event: Event; foldState: unknown }) => string;
}

/**
 * Definition of a subscriber — a post-fold side-effect handler.
 *
 * A subscriber is tied to a specific fold projection and is dispatched
 * after every fold apply + store succeeds. This guarantees correctness:
 * if the fold fails, the subscriber never fires.
 *
 * Subscribers fire on every fold completion unless a `shouldDispatch`
 * predicate filters the event out before enqueue.
 *
 * Dedup is opt-in and has two entry points that must agree: `deduplication`
 * is the full GroupQueue contract, and `makeJobId` + `ttl` is the router's
 * pre-staging batch-collapse view. The builder points both at one key function so they
 * cannot drift. A subscriber declaring neither dispatches one job per event.
 *
 * See the package reaction contract in `REACTIONS.md`.
 */
export interface SubscriberDispatchDefinition<E extends Event = Event, FoldState = unknown> {
  /** Unique name for this subscriber */
  name: string;
  /**
   * Optional pure predicate evaluated at dispatch time, before any job is
   * enqueued. Return false to skip this subscriber entirely for the event.
   *
   * Must be pure and synchronous — no IO, no injected dependencies; it runs
   * on the projection hot path. Guards that need dependencies (DB lookups
   * etc.) belong in handle(). A thrown predicate is caught, logged, and
   * treated as true (fail open — never drops a side effect).
   *
   * The queue payload `{ event, foldState }` is captured at dispatch, so the
   * predicate sees exactly what handle() would receive — do not use this for
   * conditions that should be re-evaluated against fresher state later.
   */
  shouldDispatch?(event: E, context: SubscriberDispatchContext<FoldState>): boolean;
  /** Side-effect handler called after fold succeeds */
  handle(event: E, context: SubscriberDispatchContext<FoldState>): Promise<void>;
  /** Optional configuration */
  options?: SubscriberDispatchOptions;
}
