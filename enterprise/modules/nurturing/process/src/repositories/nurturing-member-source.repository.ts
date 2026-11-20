// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One current member of an organization as its owners hold it. */
export type NurturingSourceMember = Readonly<{
  userId: string;
  /** When the owners' membership row was created, epoch ms. */
  joinedAt: number;
}>;

/**
 * Organization's `OrganizationUser` rows, read through their share, never a copy (R40). It
 * claims no table: the owners keep theirs. Only the member backfill reads it.
 */
export interface NurturingMemberSourceRepository {
  /**
   * Members whose membership is not disabled. A deactivated user is still listed: deactivation
   * lives on `User`, which this read may not touch, so callers filter it through the owner's API.
   */
  findActiveMembers(input: Readonly<{ organizationId: string }>): Promise<NurturingSourceMember[]>;
}
