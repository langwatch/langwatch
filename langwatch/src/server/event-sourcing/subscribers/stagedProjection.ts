import type { Event } from "../domain/types";

/**
 * Discriminant key stamped on a staged subscriber job that carries a
 * pre-computed projection instead of the full source event (payload-cost
 * doctrine invariant 4 — ADR-069). Its presence — and only its presence — is
 * how a handler tells a projected job (staged by a build that has the
 * projection) from a full-event job (a pre-upgrade job, or a subscriber with no
 * `project`). A raw `Event` never carries this key, so the discrimination is
 * structural and mixed-deploy safe.
 *
 * The double-underscore prefix matches the queue's own routing metadata
 * (`__pipelineName`/`__jobType`/`__jobName`) and, like them, is a reserved key
 * a domain event never uses.
 */
export const STAGED_SUBSCRIBER_PROJECTION_MARKER =
  "__esSubscriberProjection" as const;

/**
 * The envelope a subscriber's enqueue-time projection is staged inside.
 *
 * It mirrors the routing-relevant fields of the source event at the top level
 * so the global queue's group-key, score, dedup and span-attribute callbacks
 * keep resolving exactly as they do for a full event — the projection changes
 * only what the handler re-buys, never how the job is scheduled. `projection`
 * is the small payload the subscriber lifted.
 */
export interface StagedSubscriberProjection<P = unknown> {
  /** Shape version. 1 = this `{ ...routing, projection }` envelope. */
  readonly [STAGED_SUBSCRIBER_PROJECTION_MARKER]: 1;
  readonly tenantId: Event["tenantId"];
  readonly aggregateType: Event["aggregateType"];
  readonly aggregateId: string;
  readonly occurredAt: number;
  readonly createdAt: number;
  readonly id: string;
  readonly type: string;
  readonly projection: P;
}

/**
 * Wraps a subscriber's projected payload in the staged envelope, mirroring the
 * source event's routing metadata so scheduling stays identical.
 */
export function makeStagedProjection({
  event,
  projection,
}: {
  event: Event;
  projection: unknown;
}): StagedSubscriberProjection {
  return {
    [STAGED_SUBSCRIBER_PROJECTION_MARKER]: 1,
    tenantId: event.tenantId,
    aggregateType: event.aggregateType,
    aggregateId: String(event.aggregateId),
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    id: event.id,
    type: event.type,
    projection,
  };
}

/** Structural discriminator for the staged-projection envelope. */
export function isStagedProjection(
  value: unknown,
): value is StagedSubscriberProjection {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[STAGED_SUBSCRIBER_PROJECTION_MARKER] === 1
  );
}

/**
 * Returns the carried projection when `value` is a staged-projection envelope,
 * otherwise `null`. The caller supplies the projection type it staged; nothing
 * validates it here, so only the subscriber that produced the projection should
 * read it back.
 */
export function readStagedProjection<P>(value: unknown): P | null {
  return isStagedProjection(value)
    ? (value.projection as P)
    : null;
}
