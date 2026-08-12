/**
 * ADR-092 — the Prisma implementation of AuthzGrantsRepository: every write
 * the grants surface performs, plus the tenancy lookups it validates with.
 * Atomicity lives here (replaceBinding and offboardUser own their
 * transactions); validation, failure naming, and the offboarding proof stay
 * in @langwatch/authz-server's GrantsService. Prisma's P2002 is mapped to
 * the port's DuplicateBindingError at this boundary so the service never
 * sees an engine-specific error.
 */
import type {
  AuthzGrantsRepository,
  AuthzReadRepository,
  BindingPrincipalWhere,
  OffboardCounts,
  RoleBindingWrite,
} from "@langwatch/authz-server";
import { DuplicateBindingError } from "@langwatch/authz-server";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaAuthzReadRepository } from "./authz-read.prisma.repository";

function bindingData(row: RoleBindingWrite) {
  return {
    id: row.bindingId,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    role: row.role,
    customRoleId: row.customRoleId,
    userId: row.userId,
    groupId: row.groupId,
    apiKeyId: row.apiKeyId,
  };
}

function mapDuplicate(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new DuplicateBindingError();
  }
  throw error;
}

export class PrismaAuthzGrantsRepository implements AuthzGrantsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createBinding(row: RoleBindingWrite): Promise<void> {
    try {
      await this.prisma.roleBinding.create({ data: bindingData(row) });
    } catch (error) {
      mapDuplicate(error);
    }
  }

  async updateBindingRole({
    bindingId,
    role,
    customRoleId,
  }: {
    bindingId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
  }): Promise<void> {
    try {
      await this.prisma.roleBinding.update({
        where: { id: bindingId },
        data: { role, customRoleId },
      });
    } catch (error) {
      mapDuplicate(error);
    }
  }

  async deleteBinding({ bindingId }: { bindingId: string }): Promise<void> {
    await this.prisma.roleBinding.delete({ where: { id: bindingId } });
  }

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

  async findCustomRoleOrganization({
    customRoleId,
  }: {
    customRoleId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.prisma.customRole.findUnique({
      where: { id: customRoleId },
      select: { organizationId: true },
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

  async replaceBinding({
    deleteWhere,
    create,
  }: {
    deleteWhere: {
      organizationId: string;
      scopeType: RoleBindingWrite["scopeType"];
      scopeId: string;
      principal: BindingPrincipalWhere;
    };
    create: RoleBindingWrite;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.roleBinding.deleteMany({
          where: {
            organizationId: deleteWhere.organizationId,
            scopeType: deleteWhere.scopeType,
            scopeId: deleteWhere.scopeId,
            ...deleteWhere.principal,
          },
        });
        await tx.roleBinding.create({ data: bindingData(create) });
      });
    } catch (error) {
      mapDuplicate(error);
    }
  }

  async findUserEmail({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  async offboardUser({
    userId,
    organizationId,
    email,
    prove,
  }: {
    userId: string;
    organizationId: string;
    email: string | null;
    prove: (txReader: AuthzReadRepository) => Promise<void>;
  }): Promise<OffboardCounts> {
    return this.prisma.$transaction(async (tx) => {
      const bindings = await tx.roleBinding.deleteMany({
        where: { organizationId, userId },
      });
      const groupMemberships = await tx.groupMembership.deleteMany({
        where: { userId, group: { organizationId } },
      });
      const legacyTeamMemberships = await tx.teamUser.deleteMany({
        where: { userId, team: { organizationId } },
      });
      const organizationMembership = await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
      });
      const pendingInvites = email
        ? await tx.organizationInvite.deleteMany({
            where: { organizationId, email, status: "PENDING" },
          })
        : { count: 0 };

      // The proof runs against THIS transaction, so the deletes above are
      // visible to it; a throw rolls the whole offboarding back.
      await prove(new PrismaAuthzReadRepository(tx));

      return {
        bindings: bindings.count,
        groupMemberships: groupMemberships.count,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    });
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
