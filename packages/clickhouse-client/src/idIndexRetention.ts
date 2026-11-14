/**
 * The retention raise over an id index: one `ALTER … UPDATE` per index and target, each tenant
 * raised to its own days through `transform`, never lowered. Shared by data-retention's raise and
 * eventing's event_log index, so both write the same statement.
 */

/** The id index writes "kept forever" (a source's 0) as the highest value, so `max` keeps it. */
export const ID_INDEX_KEPT_FOREVER_DAYS = 65_535;

/**
 * Bytes of bound tenant ids one raise carries. Each parameter is one URL field, and the server caps
 * a field at `http_max_field_value_size` (128 KiB) before the URI's 1 MiB, so the budget sits under
 * the field cap: past it the server refuses the request ("Field value too long").
 */
export const ID_INDEX_RAISE_PARAM_BYTES = 100 * 1024;

/**
 * The array's URL-encoded brackets, `%5B` and `%5D`. The days travel in their own, smaller field.
 */
const ARRAY_BRACKET_BYTES = 6;

/** The client's string escapes in a query parameter, as `formatQueryParams` writes them. */
const PARAM_STRING_ESCAPES: Record<string, string> = {
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  "'": "\\'",
  "\\": "\\\\",
};

/**
 * Bytes one id adds to the `{tenantIds}` field as the client sends it: escaped, quoted, followed by
 * a comma, and form-encoded by `URLSearchParams`. A quote or backslash costs 6 bytes, not 1.
 */
export function idIndexRaiseParamBytes(tenantId: string): number {
  const escaped = tenantId.replace(/[\t\n\r'\\]/g, (c) => PARAM_STRING_ESCAPES[c]!);
  return new URLSearchParams([["", `'${escaped}',`]]).toString().length - 1;
}

/** One raise's parameters: the tenants, and each one's days at the same position. */
export type IdIndexRetentionBatch = {
  tenantIds: string[];
  retentionDays: number[];
};

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
  let bytes = ARRAY_BRACKET_BYTES;
  const sorted = [...daysByTenant].toSorted(([left], [right]) => left.localeCompare(right));
  for (const [tenantId, days] of sorted) {
    const size = idIndexRaiseParamBytes(tenantId);
    if (ARRAY_BRACKET_BYTES + size > paramBytes) {
      throw new Error(
        `Tenant id of ${size} encoded bytes cannot fit one id index raise of ${paramBytes} bytes`,
      );
    }
    if (current.tenantIds.length > 0 && bytes + size > paramBytes) {
      raises.push(current);
      current = { tenantIds: [], retentionDays: [] };
      bytes = ARRAY_BRACKET_BYTES;
    }
    current.tenantIds.push(tenantId);
    current.retentionDays.push(idIndexRetentionDays(days));
    bytes += size;
  }
  if (current.tenantIds.length > 0) raises.push(current);
  return raises;
}
