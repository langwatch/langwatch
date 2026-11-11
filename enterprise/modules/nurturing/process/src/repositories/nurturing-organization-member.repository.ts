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
  /** Keeps the latest time of the change: a redelivered or late fact changes nothing. */
  recordMembershipChange(
    input: Readonly<{
      organizationId: string;
      userId: string;
      change: NurturingMembershipChange;
      at: number;
    }>,
  ): Promise<void>;
  /** Every membership, of any organization, of the people with one in `organizationId`. */
  findMembershipsOfMembers(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingMembership[]>;
}
