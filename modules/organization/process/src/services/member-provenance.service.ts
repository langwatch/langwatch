import type { OrganizationMemberProvenance } from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import {
  type MemberDomainAdmission,
  memberProvenanceFor,
} from "../rules/member-provenance.rules.ts";

/** The domain admissions identity records, asked per call of a peer resolved lazily. */
export interface MemberDomainAdmissions {
  findForMembers(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<MemberDomainAdmission[]>;
}

/** Why each member of an organization is here, for the members list and the member dialog. */
export class MemberProvenanceService {
  static create(dependencies: {
    members: Pick<OrganizationMembershipRepository, "findMemberUserIds" | "findInvitedMemberIds">;
    admissions: MemberDomainAdmissions;
  }): MemberProvenanceService {
    return new MemberProvenanceService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      members: Pick<OrganizationMembershipRepository, "findMemberUserIds" | "findInvitedMemberIds">;
      admissions: MemberDomainAdmissions;
    },
  ) {}

  async getForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Record<string, OrganizationMemberProvenance>> {
    const userIds = await this.dependencies.members.findMemberUserIds({ organizationId });
    if (userIds.length === 0) return {};
    const [admissions, invitedUserIds] = await Promise.all([
      this.dependencies.admissions.findForMembers({ organizationId, userIds }),
      this.dependencies.members.findInvitedMemberIds({ organizationId, userIds }),
    ]);
    return memberProvenanceFor({ userIds, admissions, invitedUserIds });
  }
}
