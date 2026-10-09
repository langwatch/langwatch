import type { ConnectOrganizationRecord } from "../../../repositories/connect-organization.repository.ts";
import { connectServicesDisabledAfter } from "../../../rules/connect-entitlement.rules.ts";
import type { LicensingCustomerFactsService } from "../../licensing-customer-facts.service.ts";

/** Licensing's Connect facts, applied to the memory rows the way organization's subscriber does. */
export function appliedConnectFacts(
  rows: Map<string, ConnectOrganizationRecord>,
): Pick<LicensingCustomerFactsService, "connectServiceSwitched" | "licenseSyncFinished"> {
  const update = (
    organizationId: string,
    change: (row: ConnectOrganizationRecord) => ConnectOrganizationRecord,
  ): void => {
    const row = rows.get(organizationId);
    if (row) rows.set(organizationId, change(row));
  };
  return {
    connectServiceSwitched: async ({ organizationId, service, enabled }) =>
      update(organizationId, (row) => ({
        ...row,
        servicesDisabled: connectServicesDisabledAfter({
          current: row.servicesDisabled,
          service,
          enabled,
        }),
      })),
    licenseSyncFinished: async ({ organizationId, at, error }) =>
      update(organizationId, (row) =>
        error ? { ...row, lastSyncError: error } : { ...row, lastSyncAt: at, lastSyncError: null },
      ),
  };
}
