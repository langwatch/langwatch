/**
 * A listed trace's identity: its project and trace id together. On an aggregate
 * two members may hold the same trace id (ADR-177), so the server reads that key
 * a page and the list that looks each row up share this one key.
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
