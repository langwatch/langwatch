// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The tenancy assertion the governance append stores make before they write.
 *
 * Each of these stores takes the tenant from the RECORD its map projection
 * produced and ignores the store context the router resolved. That is correct
 * today only because every `map()` sets `tenantId: event.tenantId` — which
 * makes the map implementation the sole thing standing between one tenant's
 * spend, KPIs and audit events and another tenant's tables. A future map that
 * derives the tenant from a payload field, or forgets to set it on a new
 * record shape, would route the write silently and durably.
 *
 * So the two are compared here, at the write, where the router's own answer is
 * in scope. It costs a string comparison per record and turns a silent
 * cross-tenant write into a loud failure.
 */

import type { TenantId } from "~/server/event-sourcing.old/domain/tenantId";
import { SecurityError } from "~/server/event-sourcing.old/services/errorHandling";

/**
 * Throws unless the record's tenant is the tenant the router resolved for it.
 *
 * @param store - The store's name, for the error's operation field.
 * @param recordTenantId - The tenant the map projection put on the record.
 * @param contextTenantId - The tenant the router derived from the event.
 */
export function assertRecordTenant({
  store,
  recordTenantId,
  contextTenantId,
}: {
  store: string;
  recordTenantId: string;
  contextTenantId: TenantId;
}): void {
  if (recordTenantId === String(contextTenantId)) return;
  throw new SecurityError(
    store,
    `record tenant does not match the projection context tenant; refusing to write (record: ${recordTenantId})`,
    String(contextTenantId),
  );
}

/** {@link assertRecordTenant} for a bulk write: every row, one context. */
export function assertRecordsTenant({
  store,
  records,
  contextTenantId,
}: {
  store: string;
  records: readonly { tenantId: string }[];
  contextTenantId: TenantId;
}): void {
  for (const record of records) {
    assertRecordTenant({
      store,
      recordTenantId: record.tenantId,
      contextTenantId,
    });
  }
}
