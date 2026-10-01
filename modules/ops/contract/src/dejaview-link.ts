/** The operator DejaView address that opens one aggregate's event history. */
export function dejaViewHref({
  aggregateId,
  tenantId,
}: {
  aggregateId: string;
  tenantId: string;
}): string {
  return `/ops/dejaview#a=${encodeURIComponent(aggregateId)}&at=${encodeURIComponent(tenantId)}`;
}
