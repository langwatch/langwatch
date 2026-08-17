/**
 * ADR-092 — the Prisma implementation of AuthzGrantsRepository: every write
 * the grants surface performs, plus the tenancy lookups it validates with.
 * Atomicity lives here (replaceBinding and offboardUser own their
 * transactions); validation, failure naming, and the offboarding proof stay
 * in @langwatch/authz-server's GrantsService. Prisma's P2002 and P2025 are
 * mapped to the port's DuplicateBindingError / BindingMissingError at this
 * boundary so the service never sees an engine-specific error.
 */
import type {
  AuthzGrantsRepository,
  AuthzReadRepository,
  BindingPrincipalWhere,
  GrantWriteActor,
  OffboardCounts,
  RoleBindingWrite,
} from "@langwatch/authz-server";
import {
  BindingMissingError,
  DuplicateBindingError,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { Prisma } from "~/generated/prisma/client";
import { PrismaAuthzReadRepository } from "./authz-read.prisma.repository";

/**
 * The union back onto the three nullable columns. The other two are written
 * as explicit nulls rather than left off: this is the one place the "exactly
 * one principal" shape the port guarantees is turned back into columns that
 * could each hold a value, so it says so.
 */
function principalColumns(principal: BindingPrincipalWhere) {
  return {
    userId: "userId" in principal ? principal.userId : null,
    groupId: "groupId" in principal ? principal.groupId : null,
    apiKeyId: "apiKeyId" in principal ? principal.apiKeyId : null,
  };
}

function bindingData(row: RoleBindingWrite) {
  return {
    id: row.bindingId,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    role: row.role,
    customRoleId: row.customRoleId,
    ...principalColumns(row.principal),
  };
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function mapDuplicate(error: unknown): never {
  if (isPrismaCode(error, "P2002")) {
    throw new DuplicateBindingError();
  }
  throw error;
}

/** P2025 is Prisma's "row the write targeted is not there". */
function mapDuplicateOrMissing(error: unknown): never {
  if (isPrismaCode(error, "P2025")) {
    throw new BindingMissingError();
  }
  mapDuplicate(error);
}

export class PrismaAuthzGrantsRepository implements AuthzGrantsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createBinding(
    row: RoleBindingWrite,
    _context: { actor: GrantWriteActor },
  ): Promise<void> {
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
    organizationId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    actor: GrantWriteActor;
  }): Promise<void> {
    try {
      await this.prisma.roleBinding.update({
        where: { id: bindingId },
        data: { role, customRoleId },
      });
    } catch (error) {
      mapDuplicateOrMissing(error);
    }
  }

  async deleteBinding({
    bindingId,
  }: {
    bindingId: string;
    organizationId: string;
    actor: GrantWriteActor;
  }): Promise<void> {
    try {
      await this.prisma.roleBinding.delete({ where: { id: bindingId } });
    } catch (error) {
      mapDuplicateOrMissing(error);
    }
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
    actor: GrantWriteActor;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.roleBinding.deleteMany({
          where: {
            organizationId: deleteWhere.organizationId,
            scopeType: deleteWhere.scopeType,
            scopeId: deleteWhere.scopeId,
            ...deleteWhere.principal,
          },
        });
        // Nothing to reduce: the broad grant this call narrows is already
        // gone. Thrown inside the transaction so the create rolls back with
        // it - a replace must never leave the new binding alongside no
        // removal.
        if (deleted.count === 0) throw new BindingMissingError();
        await tx.roleBinding.create({ data: bindingData(create) });
      });
    } catch (error) {
      mapDuplicateOrMissing(error);
    }
  }

  async offboardUser({
    userId,
    organizationId,
    prove,
  }: {
    userId: string;
    organizationId: string;
    actor: GrantWriteActor;
    prove: (txReader: AuthzReadRepository) => Promise<void>;
  }): Promise<OffboardCounts> {
    return this.prisma.$transaction(
      async (tx) => {
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
        // Pending invites are keyed by email, not by user id, so the address
        // has to be read to match them. It is read HERE so the lookup and the
        // delete commit or roll back together with the other offboarding
        // writes; reading it before the transaction widened the window in
        // which an address change strands a live invite the returned counts
        // claim was removed. (The transaction does not serialize against a
        // concurrent email update itself — that residual race is the email
        // writer's, not this read's.)
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        const email = user?.email ?? null;
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
      },
      // Seven sequential statements plus the re-collecting proof share this
      // transaction; Prisma's default 5s timeout would roll the whole
      // offboarding back on a slow pool, so give it explicit room.
      { timeout: 15_000 },
    );
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
