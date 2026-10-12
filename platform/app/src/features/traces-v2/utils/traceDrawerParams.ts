/**
 * The drawer URL params that name one trace: its id, the time hint its reads
 * prune partitions with, and, on an aggregate, the member that owns it
 * (ADR-144 block F). Every opener and every in-drawer move writes the trace
 * through this, so a reload or a copied link reopens the same member's trace.
 *
 * The member is written only when it is not the drawer's own project, so a
 * plain project's drawer URLs stay exactly as they were.
 */
export function traceDrawerParams({
  traceId,
  occurredAtMs,
  tenantId,
}: {
  traceId: string;
  occurredAtMs?: number | null;
  tenantId?: string | null;
}): { traceId: string; t?: string; tenantId?: string } {
  return {
    traceId,
    ...(occurredAtMs !== null && occurredAtMs !== undefined
      ? { t: String(occurredAtMs) }
      : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

/**
 * The member to name for a trace whose own project is `ownerProjectId`, seen
 * from a drawer reading `projectId`: the owner when it is another project (an
 * aggregate's member), else null, so a plain project names no member and its
 * reads and cache keys stay as they were.
 */
export function memberTenantOf({
  ownerProjectId,
  projectId,
}: {
  ownerProjectId: string | null | undefined;
  projectId: string | null | undefined;
}): string | null {
  return ownerProjectId && ownerProjectId !== projectId ? ownerProjectId : null;
}
