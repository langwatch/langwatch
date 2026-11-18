// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One current member of an organization as its owners hold it. */
export type NurturingSourceMember = Readonly<{
  userId: string;
  /** When the owners' membership row was created, epoch ms. */
  joinedAt: number;
}>;

/**
 * Organization's `Organization` and `OrganizationUser` rows, read through their shares, never a
 * copy (R40). It claims no table: the owners keep theirs. Only the member backfill reads it.
 */
export interface NurturingMemberSourceRepository {
  /** Up to `limit` organization ids after `after`, in id order. */
  listOrganizationIds(input: Readonly<{ after?: string; limit: number }>): Promise<string[]>;
  /** Members neither disabled nor deactivated: the ones nurturing's copy holds as current. */
  findActiveMembers(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingSourceMember[]>;
}
