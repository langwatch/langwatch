import type { OrganizationInvitedMemberIds } from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";

type ProvenanceMembers = Pick<
  OrganizationMembershipRepository,
  "findMemberUserIds" | "findInvitedMemberIds"
>;

/**
 * Organization's half of why each member is here: who is a member and whom an invitation brought.
 * The browser joins identity's domain admissions to it (round 24 EF-3).
 */
export class MemberProvenanceService {
  static create(dependencies: { members: ProvenanceMembers }): MemberProvenanceService {
    return new MemberProvenanceService(dependencies);
  }

  private constructor(private readonly dependencies: { members: ProvenanceMembers }) {}

  async getInvitedMemberIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationInvitedMemberIds> {
    const memberUserIds = await this.dependencies.members.findMemberUserIds({ organizationId });
    if (memberUserIds.length === 0) return { memberUserIds, invitedUserIds: [] };
    const invitedUserIds = await this.dependencies.members.findInvitedMemberIds({
      organizationId,
      userIds: memberUserIds,
    });
    return { memberUserIds, invitedUserIds };
  }
}
