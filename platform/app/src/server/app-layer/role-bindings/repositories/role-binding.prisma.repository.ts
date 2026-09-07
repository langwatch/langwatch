import {
  type PrismaClient,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import { CutoverAwareAccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.cutover.repository";
import type { AccessListingRepository } from "~/server/app-layer/authz/repositories/access-listing.repository";
import { ScopeNotInOrganizationError } from "~/server/role-bindings/errors";
import type {
  RoleBindingForSynthesis,
  RoleBindingRepository,
  TeamScopedMemberBinding,
} from "./role-binding.repository";

export class PrismaRoleBindingRepository implements RoleBindingRepository {
  constructor(
    private readonly prisma: PrismaClient,
    // The listing reads go through the per-organization fork (ADR-092,
    // delivery-plan PR 3 follow-up): a cut-over organization's member lists
    // are served from the ledger's own head, everyone else's from the legacy
    // tables, behind the same gate the decision fork reads.
    private readonly accessListing: AccessListingRepository = new CutoverAwareAccessListingRepository(
      prisma,
    ),
  ) {}

  async listForOrganizationsAndUser({
    orgIds,
    userId,
  }: {
    orgIds: string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    return this.accessListing.findBindingsForSynthesis({ orgIds, userId });
  }

  async listTeamScopedUserBindingsByTeamIds({
    organizationId,
    teamIds,
  }: {
    organizationId: string;
    teamIds: string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>> {
    return this.accessListing.findTeamMemberBindings({
      organizationId,
      teamIds,
    });
  }

  async validateScopeInOrg({
    organizationId,
    scopeType,
    scopeId,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<void> {
    if (scopeType === RoleBindingScopeType.ORGANIZATION) {
      if (scopeId !== organizationId) {
        throw new ScopeNotInOrganizationError(scopeType);
      }
      return;
    }

    if (scopeType === RoleBindingScopeType.TEAM) {
      const team = await this.prisma.team.findFirst({
        where: { id: scopeId, organizationId },
      });
      if (!team) {
        throw new ScopeNotInOrganizationError(scopeType);
      }
      return;
    }

    if (scopeType === RoleBindingScopeType.PROJECT) {
      const project = await this.prisma.project.findFirst({
        where: { id: scopeId },
        include: { team: { select: { organizationId: true } } },
      });
      if (!project || project.team.organizationId !== organizationId) {
        throw new ScopeNotInOrganizationError(scopeType);
      }
    }
  }
}
