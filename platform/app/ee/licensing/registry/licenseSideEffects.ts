/**
 * The two writes that follow a change to a license row but are not part of it
 * (ADR-141): ending the managed gateway key it resolved to, and bringing the
 * customer's contract budget back in line with its licenses.
 *
 * Both are skipped for a license that names no customer, because neither a key
 * nor a budget exists without one.
 */

import type {
  ConnectManagedKeyPort,
  ContractBudgetSyncPort,
  IssuedLicenseRecord,
} from "./issuedLicense";

export async function retireManagedKeyOf({
  managedKeys,
  row,
  actorId,
}: {
  managedKeys: ConnectManagedKeyPort;
  row: IssuedLicenseRecord;
  actorId: string;
}): Promise<void> {
  if (!row.virtualKeyId || !row.organizationId) return;
  await managedKeys.retire({
    virtualKeyId: row.virtualKeyId,
    organizationId: row.organizationId,
    actorId,
  });
}

export async function syncContractBudgetOf({
  contractBudgets,
  row,
  operatorId,
}: {
  contractBudgets: ContractBudgetSyncPort;
  row: IssuedLicenseRecord;
  operatorId: string;
}): Promise<void> {
  if (!row.organizationId) return;
  await contractBudgets.sync({
    organizationId: row.organizationId,
    operatorId,
  });
}
