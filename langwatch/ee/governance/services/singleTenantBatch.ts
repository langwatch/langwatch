// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The single-tenant guard both governance ClickHouse repositories put in front
 * of their batch inserts.
 *
 * Shared rather than copied: a batch write picks ONE tenant's ClickHouse client
 * and sends every row through it, so a row from another tenant would be written
 * into the wrong cluster. Both repositories reject that rather than guess, and
 * a future fix or bypass to the rule has to happen in one place instead of
 * drifting between two.
 *
 * Returns the tenant the batch belongs to, so callers resolve their client from
 * the value this checked rather than re-deriving it.
 */
export function assertSingleTenantBatch(
  rows: readonly { tenantId: string }[],
  context: string,
): string {
  const tenantId = rows[0]!.tenantId;
  if (rows.some((row) => row.tenantId !== tenantId)) {
    throw new Error(`${context}: every row must share one tenantId`);
  }
  return tenantId;
}
