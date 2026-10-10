import type { LedgerActor } from "@langwatch/authorization";
import { OffboardIncompleteError, type AuthzOffboardOutput } from "@langwatch/authz-contract";

import type { AuthzGrantRepository } from "../repositories/authz-grant.repository.ts";
import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";
import { AuthzCollectorService } from "./authz-collector.service.ts";
import type { AuthzMemberOffboardedNotice } from "./authz-member-offboarded-notice.service.ts";

export class AuthzOffboardingService {
  static create({
    repository,
    offboarded,
  }: {
    repository: AuthzGrantRepository;
    offboarded: AuthzMemberOffboardedNotice;
  }): AuthzOffboardingService {
    return new AuthzOffboardingService(repository, offboarded);
  }

  private constructor(
    private readonly repository: AuthzGrantRepository,
    private readonly offboarded: AuthzMemberOffboardedNotice,
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
    const removed = await this.repository.offboardUser({
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
    const grants = await AuthzCollectorService.create({ reader }).collectGrants({
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
