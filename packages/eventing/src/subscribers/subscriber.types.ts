import { z } from "zod";

import { EventSchema, type Event } from "../domain/types.ts";
import type { DeduplicationConfig } from "../queues/queue.types.ts";
import type { ExecutionTarget } from "../runtime.types.ts";

/**
 * A compact projection-subscriber job (ADR-069): the event's scheduling identity and the
 * subscriber's own body, never the event's data or the fold state.
 */
export const compactSubscriberJobSchema = z.object({
  event: EventSchema.pick({
    id: true,
    aggregateId: true,
    aggregateType: true,
    tenantId: true,
    createdAt: true,
    occurredAt: true,
    type: true,
  }),
  job: z.unknown(),
});

export type CompactSubscriberJob = z.infer<typeof compactSubscriberJobSchema>;

/** What a compact job's handler is told: whose job it is, never the event's content. */
export interface CompactSubscriberJobContext {
  tenantId: string;
  aggregateId: string;
}

/**
 * A projection subscriber's compact job: `stage` derives the body, `handle` parses and runs it.
 * `stageOnSend` false queues the full delivery, which `stage` turns into the body when it runs,
 * so workers that read compact bodies ship before any worker queues one.
 */
export interface CompactSubscriberJobDispatch<E extends Event = Event, FoldState = unknown> {
  stageOnSend: boolean;
  stage: (event: E, context: SubscriberDispatchContext<FoldState>) => unknown;
  handle: (job: unknown, context: CompactSubscriberJobContext) => Promise<void>;
}

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
  /** Present when the subscriber's job has a compact body; `handle` stages a full delivery. */
  compactJob?: CompactSubscriberJobDispatch<E, FoldState>;
  /** Optional configuration */
  options?: SubscriberDispatchOptions;
}
