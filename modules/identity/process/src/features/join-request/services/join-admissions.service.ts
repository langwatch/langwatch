import {
  DOMAIN_AUTO_JOIN_POLICY_ID,
  type IdentityDomainAdmission,
  type JoinAdmissionsApi,
} from "@langwatch/identity-contract";

import type { JoinRequestListReadRepository } from "../repositories/join-request.repository.ts";

/**
 * Who a matching domain admitted, read off the join-request fold:
 * the policy's own resolver id marks an admission nobody approved.
 */
export class JoinAdmissionsService implements JoinAdmissionsApi {
  static create(
    reads: Pick<JoinRequestListReadRepository, "findApprovedForOrganization">,
  ): JoinAdmissionsService {
    return new JoinAdmissionsService(reads);
  }

  private constructor(
    private readonly reads: Pick<JoinRequestListReadRepository, "findApprovedForOrganization">,
  ) {}

  async findForMembers(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<IdentityDomainAdmission[]> {
    const members = new Set(args.userIds);
    const approved = await this.reads.findApprovedForOrganization({
      organizationId: args.organizationId,
    });
    return approved
      .filter((request) => members.has(request.userId))
      .map((request) => ({
        userId: request.userId,
        domain: request.domain,
        automatic: request.resolvedById === DOMAIN_AUTO_JOIN_POLICY_ID,
      }));
  }
}
