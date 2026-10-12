/**
 * A listed trace's identity: the project that holds it and its trace id
 * together. On an aggregate two members may hold the same trace id (ADR-144
 * v4.1), so a read keyed by the id alone would put one member's data on the
 * other member's row. Shared by the server reads that key a page's results
 * and the list that looks each row up, so the two always agree on the key.
 */
export function listedTraceKey({
  projectId,
  traceId,
}: {
  projectId: string;
  traceId: string;
}): string {
  return `${projectId}:${traceId}`;
}
