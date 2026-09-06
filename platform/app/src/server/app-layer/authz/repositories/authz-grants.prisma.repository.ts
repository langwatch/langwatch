/**
 * ADR-092 — the Prisma implementation of AuthzGrantsRepository's READ half:
 * the tenancy lookups (`findTeamOrganization`, `findProjectLineage`, ...)
 * every write path validates with. `LedgerAuthzGrantsRepository` composes
 * this repository for reads and owns every write itself, through the grants
 * ledger — see authz-grants.ledger.repository.ts.
 */
import type { AuthzGrantsRepository } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";

/** The subset of the write port this repository actually implements. */
export type AuthzGrantsReadRepository = Pick<
  AuthzGrantsRepository,
  | "findBinding"
  | "findCustomRole"
  | "findTeamOrganization"
  | "findProjectLineage"
  | "findOwnedApiKeys"
  | "findPersonalTeams"
>;

export class PrismaAuthzGrantsRepository implements AuthzGrantsReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBinding({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null> {
    return this.prisma.roleBinding.findUnique({
      where: { id: bindingId },
      select: { id: true, organizationId: true },
    });
  }

  async findCustomRole({
    customRoleId,
  }: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    return this.prisma.customRole.findUnique({
      where: { id: customRoleId },
      select: { organizationId: true, permissions: true },
    });
  }

  async findTeamOrganization({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
  }

  async findProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true, organizationId: true } } },
    });
    if (!project?.team) return null;
    return {
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  }

  async findOwnedApiKeys({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.apiKey.findMany({
      where: { userId, organizationId, revokedAt: null },
      select: { id: true, name: true },
    });
  }

  async findPersonalTeams({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.team.findMany({
      where: { organizationId, isPersonal: true, ownerUserId: userId },
      select: { id: true, name: true },
    });
  }
}
