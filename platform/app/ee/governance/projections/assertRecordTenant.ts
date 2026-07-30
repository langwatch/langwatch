// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The tenancy assertion the governance append stores make before they write.
 * Each store takes the tenant from the RECORD its map produced and compares it
 * against the batch context the runtime resolved — a silent mismatch would be
 * a cross-tenant write in an auditor-facing stream.
 */

export function assertRecordTenant({
  store,
  recordTenantId,
  contextTenantId,
}: {
  store: string;
  recordTenantId: string;
  contextTenantId: string;
}): void {
  if (recordTenantId === contextTenantId) return;
  throw new Error(
    `${store}: record tenant "${recordTenantId}" does not match the batch context tenant "${contextTenantId}"; refusing to write`,
  );
}

export function assertRecordsTenant({
  store,
  records,
  contextTenantId,
}: {
  store: string;
  records: readonly { tenantId: string }[];
  contextTenantId: string;
}): void {
  for (const record of records) {
    assertRecordTenant({
      store,
      recordTenantId: record.tenantId,
      contextTenantId,
    });
  }
}
