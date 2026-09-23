import type { AggregateType } from "../domain/aggregateType.ts";
import type { TenantId } from "../domain/tenantId.ts";
import type { Event, EventMetadataBase } from "../domain/types.ts";
import type { KillSwitchOptions } from "../kill-switch/killSwitchKeys.ts";
import type { DeduplicationStrategy } from "../queues/queue.types.ts";

/**
 * A staged queue payload (ADR-069): a plain versioned job DTO a `stage` hook
 * may return in the committed event's place. Mirrors the event envelope's
 * scheduling identity but is NOT an event — never appended to the event log.
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
 * Enqueue-time hooks (routing worker, pre-staging).
 * Hooks MUST be total: dispatch has no retry, so throws are permanent losses.
 * See ADR-069 for payload-cost doctrine and deploy-order dependencies.
 */
export interface EnqueueDispatchOptions<E extends Event = Event> {
  /**
   * Total predicate: false means no job is staged; throws are permanent losses.
   * Use only cheap checks: set lookup, typeof, field comparison.
   */
  filter?: (event: E) => boolean;
  /**
   * Claim-check staging: swap payload for reference (ADR-069).
   * Must be total; introduces deploy-order dependency (consumer half must ship first).
   */
  stage?: (event: E) => Event | StagedJobPayload;
}

export interface EventSubscriberOptions<E extends Event = Event> {
  /**
   * Operator stop for this component, resolved per tenant at dispatch time.
   * Absent means the generated key; a `customKey` must also be what the
   * descriptors advertise or the switch cannot be set.
   */
  killSwitch?: KillSwitchOptions;
  /** Compile-time off switch. */
  disabled?: boolean;
  delay?: number;
  deduplication?: DeduplicationStrategy<E>;
  groupKeyFn?: (event: E) => string;
  /**
   * Enqueue-time filter (ADR-069): declined events never mint a job. During a
   * rolling deploy, older jobs staged without the filter may still be queued —
   * a handler must stay correct for events its filter would have declined.
   */
  enqueue?: EnqueueDispatchOptions<E>;
}

/**
 * A live consumer of an event already stored in the canonical event log,
 * carried through GroupQueue — never loaded back from the store, never
 * invoked by replay. Durable subscribers must make their own handling idempotent.
 */
export interface EventSubscriberDefinition<E extends Event = Event> {
  name: string;
  /** Empty means all event types. */
  eventTypes: readonly string[];
  handle: (event: E, context: EventSubscriberContext) => Promise<void>;
  options?: EventSubscriberOptions<E>;
}
