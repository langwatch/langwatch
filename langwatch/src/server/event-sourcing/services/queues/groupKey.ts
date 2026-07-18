/**
 * Composes a GroupQueue group key: `${tenantId}/${jobPath}/${domainKey}`.
 *
 * - `jobPath` reflects pipeline topology, e.g. `fold/traceSummary` or
 *   `fold/traceSummary/reactor/evaluationTrigger`
 * - `domainKey` defaults to `${aggregateType}:${aggregateId}`, overridable per
 *   projection
 *
 * Lives here rather than inside `QueueManager` so the format has exactly one
 * definition — anything deriving a group key outside the queue must produce the
 * identical string, and a hand-copied format would fail silently.
 */
export function composeGroupKey({
  tenantId,
  jobPath,
  domainKey,
}: {
  tenantId: string;
  jobPath: string;
  domainKey: string;
}): string {
  return `${tenantId}/${jobPath}/${domainKey}`;
}

/** The default domain key: aggregate type and id. */
export function defaultDomainKey({
  aggregateType,
  aggregateId,
}: {
  aggregateType: string;
  aggregateId: string;
}): string {
  return `${aggregateType}:${aggregateId}`;
}

/**
 * The lane a projection's jobs run on. Fold projections default to `fold`;
 * `state` is the separate lane registered by the process-manager substrate.
 * The lane is part of the job path, so it is part of the group key.
 */
export type ProjectionLane = "fold" | "state";

/** Group key for a projection's own jobs. */
export function projectionGroupKey({
  tenantId,
  projectionName,
  aggregateType,
  aggregateId,
  lane = "fold",
}: {
  tenantId: string;
  projectionName: string;
  aggregateType: string;
  aggregateId: string;
  lane?: ProjectionLane;
}): string {
  return composeGroupKey({
    tenantId,
    jobPath: `${lane}/${projectionName}`,
    domainKey: defaultDomainKey({ aggregateType, aggregateId }),
  });
}
