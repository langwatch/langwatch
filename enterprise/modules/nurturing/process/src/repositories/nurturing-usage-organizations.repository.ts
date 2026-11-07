// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** An organization the daily usage sync tells Customer.io about, through its admin. */
export type NurturingUsageOrganization = Readonly<{ organizationId: string; adminUserId: string }>;

/**
 * The organizations the daily usage sync reads, across every organization (ARCHITECTURE §7).
 * Read only: a sync that wrote the row would move its `updatedAt` and keep it active forever.
 */
export interface NurturingUsageOrganizationsRepository {
  /**
   * Rows with an admin that saw a trace since `since`, or, with no trace yet, were written since
   * then; by organization id, after `afterId` when one is given.
   */
  findRecentlyActive(
    input: Readonly<{ since: number; afterId?: string; limit: number }>,
  ): Promise<NurturingUsageOrganization[]>;
}
