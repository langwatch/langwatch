/**
 * The retention raise over an id index: one `ALTER … UPDATE` per index and target, each tenant
 * raised to its own days through `transform`, never lowered. Shared by data-retention's raise and
 * eventing's event_log index, so both write the same statement.
 */

/** The id index writes "kept forever" (a source's 0) as the highest value, so `max` keeps it. */
export const ID_INDEX_KEPT_FOREVER_DAYS = 65_535;

/**
 * Bytes of bound tenant ids one raise carries. Parameters travel in the HTTP URL, and the server's
 * default `http_max_uri_size` is 1 MiB, so a raise splits only past half of it.
 */
export const ID_INDEX_RAISE_PARAM_BYTES = 512 * 1024;

/** Per id: the URL-encoded quotes and comma around it, and its days with their comma. */
const PER_TENANT_OVERHEAD_BYTES = 16;

/** One raise's parameters: the tenants, and each one's days at the same position. */
export type IdIndexRetentionBatch = { tenantIds: string[]; retentionDays: number[] };

/** A source's `0` (kept forever) as the index writes it. */
export function idIndexRetentionDays(retentionDays: number): number {
  return retentionDays === 0 ? ID_INDEX_KEPT_FOREVER_DAYS : retentionDays;
}

/**
 * The `UPDATE … WHERE` of a raise, binding `{tenantIds}` and `{retentionDays}`; a caller appends
 * its own ` AND …`. The marker row (TenantId '') is never in the list, so it is never touched.
 */
export const ID_INDEX_RETENTION_RAISE =
  "UPDATE _retention_days = greatest(_retention_days, transform(TenantId, " +
  "{tenantIds:Array(String)}, {retentionDays:Array(UInt16)}, _retention_days)) " +
  "WHERE TenantId IN {tenantIds:Array(String)} " +
  `AND _retention_days < ${ID_INDEX_KEPT_FOREVER_DAYS}`;

/** The raises for every tenant, sorted for a stable plan: one, unless the ids pass the budget. */
export function idIndexRetentionRaises({
  daysByTenant,
  paramBytes = ID_INDEX_RAISE_PARAM_BYTES,
}: {
  daysByTenant: ReadonlyMap<string, number>;
  paramBytes?: number;
}): IdIndexRetentionBatch[] {
  const raises: IdIndexRetentionBatch[] = [];
  let current: IdIndexRetentionBatch = { tenantIds: [], retentionDays: [] };
  let bytes = 0;
  const sorted = [...daysByTenant].toSorted(([left], [right]) => left.localeCompare(right));
  for (const [tenantId, days] of sorted) {
    const size = encodeURIComponent(tenantId).length + PER_TENANT_OVERHEAD_BYTES;
    if (current.tenantIds.length > 0 && bytes + size > paramBytes) {
      raises.push(current);
      current = { tenantIds: [], retentionDays: [] };
      bytes = 0;
    }
    current.tenantIds.push(tenantId);
    current.retentionDays.push(idIndexRetentionDays(days));
    bytes += size;
  }
  if (current.tenantIds.length > 0) raises.push(current);
  return raises;
}
