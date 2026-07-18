/**
 * Composes a GroupQueue group key: `${tenantId}/${jobPath}/${domainKey}`.
 *
 * - `jobPath` reflects pipeline topology, e.g. `fold/traceSummary` or
 *   `fold/traceSummary/reactor/evaluationTrigger`
 * - `domainKey` defaults to `${aggregateType}:${aggregateId}`, overridable per
 *   projection
 *
 * Lives here rather than inside `QueueManager` because it is not only the queue
 * that needs it: the fold-cache confirmation processor has to ask whether an
 * aggregate still has queue work before releasing its cached state, and it can
 * only do that if it derives exactly the same key. A second, hand-copied format
 * would fail silently and in the dangerous direction — a key that does not
 * exist reads as "no work in flight", which releases a cache entry that a retry
 * still depends on.
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

/** Group key for a fold projection's own jobs. */
export function foldGroupKey({
  tenantId,
  projectionName,
  aggregateType,
  aggregateId,
}: {
  tenantId: string;
  projectionName: string;
  aggregateType: string;
  aggregateId: string;
}): string {
  return composeGroupKey({
    tenantId,
    jobPath: `fold/${projectionName}`,
    domainKey: defaultDomainKey({ aggregateType, aggregateId }),
  });
}
