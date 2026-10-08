// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Project's projects, read through the share project declares with billing (round 37 D5, R40).
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
export abstract class BillingProjectDirectoryRepository {
  /**
   * Every live project, governance included: the tenants an organization's spend
   * sums over. An aggregate is in it too and adds nothing, since it holds no rows.
   */
  abstract findProjectIds(input: { organizationId: string }): Promise<string[]>;
  /** Every project that holds usage of its own, archived too, by name: no governance, no aggregate. */
  abstract findProjectsWithName(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;
}
