// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  PrismaBillingTenantOrganizationRepository,
  type BillingTenantOrganizationDatabase,
} from "../repositories/prisma/prisma.tenant-organization.repository";
import type { BillingTenantOrganizationPort } from "../ports/tenant-organization.port";

/** The Prisma slice this feature's attribution lookup names; see the repository. */
export type { BillingTenantOrganizationDatabase };

/** The attribution lookup, as the composition root receives it. */
export type BillingTenantOrganizationPersistence = {
  organizations: BillingTenantOrganizationPort;
};

/**
 * Constructs the attribution lookup's Postgres repository without exposing it.
 *
 * Its own adapter rather than a field on `PostgresBillingAdapter` because the
 * callers are different graphs: the billable-events meter needs only this one
 * read and holds none of the subscription, checkpoint or pricing slices the
 * lifecycle services need, and a background worker composing the meter should
 * not have to name three tables it never touches.
 */
export class PostgresBillingTenantOrganizationAdapter {
  static create(options: {
    database: BillingTenantOrganizationDatabase;
  }): PostgresBillingTenantOrganizationAdapter {
    return new PostgresBillingTenantOrganizationAdapter(options.database);
  }

  private constructor(private readonly database: BillingTenantOrganizationDatabase) {}

  build(): BillingTenantOrganizationPersistence {
    return { organizations: PrismaBillingTenantOrganizationRepository.create(this.database) };
  }
}
