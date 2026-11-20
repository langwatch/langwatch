// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMembership,
  NurturingMembershipChange,
} from "../rules/nurturing-organization-member.rules.ts";

/**
 * Nurturing's own copy of who belongs to which organization (`NurturingOrganizationMember`),
 * written from the owners' member facts (§9), so the usage mirror reads no other module.
 */
export interface NurturingOrganizationMemberRepository {
  /**
   * Keeps the latest time of the change: a redelivered or late fact changes nothing, and a fact
   * for an erased account writes no row, however late it lands.
   */
  recordMembershipChange(
    input: Readonly<{
      organizationId: string;
      userId: string;
      change: NurturingMembershipChange;
      at: number;
    }>,
  ): Promise<void>;
  /**
   * Marks the account erased and deletes every membership of it, in every organization; no
   * member fact folded in afterwards writes one again.
   */
  forgetMember(input: Readonly<{ userId: string }>): Promise<void>;
  /** Every membership, of any organization, of the people with one in `organizationId`. */
  findMembershipsOfMembers(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingMembership[]>;
  /** Every membership, of any organization, of the named people, with a row here or not. */
  findMembershipsOfUsers(
    input: Readonly<{ userIds: readonly string[] }>,
  ): Promise<NurturingMembership[]>;
}
