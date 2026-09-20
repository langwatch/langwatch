/**
 * The customer a license is issued to (ADR-139): an organization that already
 * exists on LangWatch Cloud, or a bare one created for a customer who has none.
 */

import { OrganizationNotFoundError } from "../errors";
import type {
  CustomerOrganizationPort,
  LicenseCustomer,
} from "./issuedLicense";

export async function resolveLicenseCustomer({
  organizations,
  customer,
}: {
  organizations: CustomerOrganizationPort;
  customer: LicenseCustomer;
}): Promise<{ id: string; name: string }> {
  if ("newOrganizationName" in customer) {
    return organizations.createSelfHostedCustomer({
      name: customer.newOrganizationName,
    });
  }
  const organization = await organizations.findById(customer.organizationId);
  if (!organization) throw new OrganizationNotFoundError();
  return organization;
}
