// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Project's projects, read through the share project declares with billing (round 37 D5, R40).
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
export abstract class BillingProjectDirectoryRepository {
  /** Every live project, governance included: the tenants an organization's spend sums over. */
  abstract findProjectIds(input: { organizationId: string }): Promise<string[]>;
  /** Main's `findProjectsWithName`: every non-governance project, archived too, by name. */
  abstract findProjectsWithName(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;
}
