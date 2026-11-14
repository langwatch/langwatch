import type { LedgerActor } from "@langwatch/authorization";
import { OffboardIncompleteError, type AuthzOffboardOutput } from "@langwatch/authz-contract";

import type { AuthzGrantRepository } from "../repositories/authz-grant.repository.ts";
import type { AuthzOrganizationPolicyRepository } from "../repositories/authz-organization-policy.repository.ts";
import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";
import { AuthzCollectorService } from "./authz-collector.service.ts";
import type { AuthzMemberOffboardedNotice } from "./authz-member-offboarded-notice.service.ts";

type OrganizationPolicies = Pick<AuthzOrganizationPolicyRepository, "getPolicy">;

export class AuthzOffboardingService {
  static create({
    repository,
    offboarded,
    policies,
  }: {
    repository: AuthzGrantRepository;
    offboarded: AuthzMemberOffboardedNotice;
    policies: OrganizationPolicies;
  }): AuthzOffboardingService {
    return new AuthzOffboardingService(repository, offboarded, policies);
  }

  private constructor(
    private readonly repository: AuthzGrantRepository,
    private readonly offboarded: AuthzMemberOffboardedNotice,
    private readonly policies: OrganizationPolicies,
  ) {}

  async offboard({
    actor,
    userId,
    organizationId,
  }: {
    actor: LedgerActor;
    userId: string;
    organizationId: string;
  }): Promise<AuthzOffboardOutput> {
    const { heldFullSeat, ...removed } = await this.repository.offboardUser({
      userId,
      organizationId,
      actor,
      prove: (reader) => this.proveNothingResolves({ reader, userId, organizationId }),
    });
    // Only the call that deleted the seat records it, so a retry finds no row and records nothing.
    if (removed.organizationMembership) {
      await this.offboarded.memberOffboarded({
        organizationId,
        userId,
        offboardedByUserId: actor.type === "user" ? actor.id : null,
        heldFullSeat,
      });
    }
    const [ownedApiKeys, personalTeams] = await Promise.all([
      this.repository.findOwnedApiKeys({ userId, organizationId }),
      this.repository.findPersonalTeams({ userId, organizationId }),
    ]);

    return { removed, needsHumanDecision: { ownedApiKeys, personalTeams } };
  }

  private async proveNothingResolves({
    reader,
    userId,
    organizationId,
  }: {
    reader: AuthzReadRepository;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const grants = await AuthzCollectorService.create({
      reader,
      policies: this.policies,
    }).collectGrants({
      principal: { type: "user", id: userId },
      organizationId,
    });
    if (!grants.isOrgMember && grants.bindings.length === 0) return;

    throw new OffboardIncompleteError({
      userId,
      organizationId,
      remainingBindings: grants.bindings.length,
      stillOrgMember: grants.isOrgMember,
    });
  }
}
