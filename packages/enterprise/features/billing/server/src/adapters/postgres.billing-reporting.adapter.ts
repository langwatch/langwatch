// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type BillingCheckpointDatabase,
  PrismaBillingCheckpointRepository,
} from "../repositories/prisma/prisma.billing-checkpoint.repository";
import {
  type BillingReportOrganizationDatabase,
  PrismaBillingReportOrganizationRepository,
} from "../repositories/prisma/prisma.billing-report-organization.repository";
import type { BillingCheckpointPort } from "../ports/billing-checkpoint.port";
import type { BillingReportOrganizationPort } from "../ports/billing-report-organization.port";

/** The two models the monthly roll-up reads or writes, and no other. */
export type BillingReportingDatabase = BillingCheckpointDatabase &
  BillingReportOrganizationDatabase;

/** The reporting graph's Postgres half, as the composition root receives it. */
export type BillingReportingPersistence = {
  checkpoints: BillingCheckpointPort;
  organizations: BillingReportOrganizationPort;
};

/**
 * Constructs the monthly roll-up's Postgres repositories without exposing them.
 *
 * Its own adapter rather than a field on `PostgresBillingAdapter` for the
 * reason the attribution lookup has one: the callers are different graphs. A
 * background worker composing the reporting pipeline touches the checkpoint
 * and one organization read, and should not have to name the pricing and
 * subscription slices the lifecycle services need.
 */
export class PostgresBillingReportingAdapter {
  static create(options: { database: BillingReportingDatabase }): PostgresBillingReportingAdapter {
    return new PostgresBillingReportingAdapter(options.database);
  }

  private constructor(private readonly database: BillingReportingDatabase) {}

  build(): BillingReportingPersistence {
    return {
      checkpoints: PrismaBillingCheckpointRepository.create(this.database),
      organizations: PrismaBillingReportOrganizationRepository.create(this.database),
    };
  }
}
