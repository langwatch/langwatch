/**
 * ADR-092 — the Prisma implementation of AuthzGrantsRepository's READ half:
 * the tenancy lookups (`tryFindTeamOrganization`, `tryFindProjectLineage`, ...)
 * every write path validates with. `LedgerAuthzGrantsRepository` composes
 * this repository for reads and owns every write itself, through the grants
 * ledger — see authz-grants.ledger.repository.ts.
 */
import type { AuthzDatabase } from "../authz-read.repository";
import type { AuthzGrantRepository } from "../authz-grant.repository";

/** The subset of the write port this repository actually implements. */
export type AuthzGrantsReadRepository = Pick<
  AuthzGrantRepository,
  | "tryFindBinding"
  | "tryFindCustomRole"
  | "tryFindTeamOrganization"
  | "tryFindProjectLineage"
  | "findOwnedApiKeys"
  | "findPersonalTeams"
>;

type PrismaAuthzGrantDatabase = {
  roleBinding: {
    findUnique(args: unknown): Promise<{ id: string; organizationId: string } | null>;
  };
  customRole: {
    findUnique(
      args: unknown,
    ): Promise<{ organizationId: string; permissions: unknown } | null>;
  };
  team: {
    findUnique(args: unknown): Promise<{ organizationId: string } | null>;
    findMany(args: unknown): Promise<Array<{ id: string; name: string }>>;
  };
  project: {
    findUnique(args: unknown): Promise<{
      team: { id: string; organizationId: string } | null;
    } | null>;
  };
  apiKey: {
    findMany(args: unknown): Promise<Array<{ id: string; name: string }>>;
  };
};

export class PrismaAuthzGrantRepository implements AuthzGrantsReadRepository {
  static create(database: AuthzDatabase): PrismaAuthzGrantRepository {
    return new PrismaAuthzGrantRepository(
      database as unknown as PrismaAuthzGrantDatabase,
    );
  }

  private constructor(private readonly prisma: PrismaAuthzGrantDatabase) {}

  async tryFindBinding({
    bindingId,
  }: {
    bindingId: string;
  }): Promise<{ id: string; organizationId: string } | null> {
    return this.prisma.roleBinding.findUnique({
      where: { id: bindingId },
      select: { id: true, organizationId: true },
    });
  }

  async tryFindCustomRole({
    customRoleId,
  }: {
    customRoleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    return this.prisma.customRole.findUnique({
      where: { id: customRoleId },
      select: { organizationId: true, permissions: true },
    });
  }

  async tryFindTeamOrganization({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
  }

  async tryFindProjectLineage({
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
