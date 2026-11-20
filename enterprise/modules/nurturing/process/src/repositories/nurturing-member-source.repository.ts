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
  /** Members neither disabled nor deactivated: the ones nurturing's copy holds as current. */
  findActiveMembers(input: Readonly<{ organizationId: string }>): Promise<NurturingSourceMember[]>;
}
