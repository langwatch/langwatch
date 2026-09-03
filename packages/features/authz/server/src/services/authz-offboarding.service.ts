import type { LedgerActor } from "@langwatch/actor";
import { OffboardIncompleteError, type AuthzOffboardOutput } from "@langwatch/authz-contract";
import type { AuthzGrantRepository } from "../repositories/authz-grant.repository";
import type { AuthzReadRepository } from "../repositories/authz-read.repository";
import { AuthzCollectorService } from "./authz-collector.service";

export class AuthzOffboardingService {
  static create(repository: AuthzGrantRepository): AuthzOffboardingService {
    return new AuthzOffboardingService(repository);
  }

  private constructor(private readonly repository: AuthzGrantRepository) {}

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
    const offboardIncomplete =
      grants.isOrgMember || grants.bindings.length > 0 || grants.legacyTeamMemberships.length > 0;
    if (!offboardIncomplete) {
      return;
    }

    throw new OffboardIncompleteError({
      userId,
      organizationId,
      remainingBindings: grants.bindings.length,
      remainingLegacyRows: grants.legacyTeamMemberships.length,
      stillOrgMember: grants.isOrgMember,
    });
  }
}
