import type { AggregateType } from "../domain/aggregateType";
import type { TenantId } from "../domain/tenantId";
import type { Event, EventMetadataBase } from "../domain/types";
import type { DeduplicationStrategy } from "../queues/queue.types";

/**
 * A staged queue payload (ADR-069): a plain versioned job DTO a `stage` hook
 * may return in the committed event's place. It mirrors the event envelope's
 * scheduling identity so the queue orders, groups and dedups it identically,
 * but it is NOT an event — its `type` is a plain wire string outside the
 * event-type registry, it is never appended to the event log, and only the
 * subscriber that staged it reads it.
 */
export interface StagedJobPayload {
  id: string;
  aggregateId: string;
  aggregateType: AggregateType;
  tenantId: TenantId;
  createdAt: number;
  occurredAt: number;
  type: string;
  version: string;
  data: unknown;
  metadata?: EventMetadataBase;
  idempotencyKey?: string;
}

/** Metadata available to an event-only subscriber. Fold state is deliberately absent. */
export interface EventSubscriberContext {
  tenantId: string;
  aggregateId: string;
}

/**
 * Enqueue-time hook evaluated at fan-out — in the routing worker, while the
 * committed event is already in memory — BEFORE any subscriber job is staged
 * (payload-cost doctrine invariant 4 — ADR-069).
 *
 * **A hook here MUST be total.** The routing/dispatch path has no retry: the
 * only production caller of `ProjectionRouter.dispatch` is
 * `EventSourcingService.storeEvents`, which logs a dispatch failure and
 * continues so that a projection fault cannot fail an already-committed write.
 * Nothing re-dispatches subscriber fan-out afterwards. So a hook that throws
 * loses this subscriber's job for this event permanently — the failure is
 * reported (logged, and surfaced as an `AggregateError` from `dispatch`), but
 * it is not recoverable.
 *
 * Blast radius is one `(subscriber, event)` pair: dispatch catches per event,
 * so the other subscribers and the other events in the batch still fan out.
 *
 * That is the whole reason this seam takes only cheap, total predicates.
 * Anything data-dependent or fallible — decoding, normalization, I/O —
 * belongs in the handler's own consumer lane, where a failure retries just
 * that subscriber's job instead of dropping it.
 */
export interface EnqueueDispatchOptions<E extends Event = Event> {
  /**
   * Predicate deciding whether a job is staged at all. `false` → no job is ever
   * minted for this event (the cheapest job is the one that never exists).
   *
   * A throw is NOT read as `false`: it is reported as a dispatch failure so
   * the fault is visible rather than silently indistinguishable from "not
   * relevant". It is still a permanent loss of this job — see the interface
   * docblock. Restrict this to predicates that cannot throw (a set lookup, a
   * typeof check, a field comparison).
   */
  filter?: (event: E) => boolean;
  /**
   * Claim-check staging (ADR-069): swap the staged payload for a small
   * reference payload that mirrors the source event's scheduling identity (id,
   * aggregate, tenant, occurredAt) while the payload stays in its canonical
   * store. Total field-picks only — no decoding, no normalization; return the
   * source event unchanged when a reference cannot be built. The handler must
   * understand every shape this can return, plus the full event (pre-upgrade
   * jobs). Runs after `filter` accepted the event.
   *
   * Same no-retry rule as `filter`: the routing path does not retry, so a throw
   * here is reported loudly and still loses this subscriber's job for this
   * event permanently. `stage` must be total for the same reason `filter` is.
   *
   * **Introducing a `stage` hook is a deploy-order dependency.** A staged
   * payload is a different wire type, and subscriber fan-out is never
   * replayed, so during a rolling deploy a job staged by a new worker can be
   * drained by one running the previous build — whose handler does not
   * recognise the reference, returns, and *completes* the job, with no throw,
   * no retry, no drop counter and no log. Ship the consumer half at least one
   * release ahead of the producer half, and see ADR-069 for the exposure this
   * leaves on upgrades that cross both in one step.
   */
  stage?: (event: E) => Event | StagedJobPayload;
}

export interface EventSubscriberOptions<E extends Event = Event> {
  /** Compile-time off switch. */
  disabled?: boolean;
  delay?: number;
  deduplication?: DeduplicationStrategy<E>;
  groupKeyFn?: (event: E) => string;
  /**
   * Enqueue-time filter (ADR-069): declined events never mint a job. During a
   * rolling deploy, jobs staged by a build without the filter can still be in
   * the queue — a handler must stay correct for events its filter would have
   * declined.
   */
  enqueue?: EnqueueDispatchOptions<E>;
}

/**
 * A live consumer of an event that has already been stored in the canonical
 * event log. The same event is carried through GroupQueue; subscribers do not
 * load it back from the event store and are not invoked by projection replay.
 *
 * Durable subscribers must make their own handling idempotent. Process
 * managers do that with their transactional inbox.
 */
export interface EventSubscriberDefinition<E extends Event = Event> {
  name: string;
  /** Empty means all event types. */
  eventTypes: readonly string[];
  handle: (event: E, context: EventSubscriberContext) => Promise<void>;
  options?: EventSubscriberOptions<E>;
}
