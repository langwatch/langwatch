import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { AuthzGrantRepository } from "../authz-grant.repository.ts";
/**
 * ADR-092 — the Prisma implementation of AuthzGrantsRepository's READ half:
 * the tenancy lookups every write path validates with.
 * `EventingAuthzGrantRepository` composes this for reads and owns every write itself.
 */

/** The subset of the write port this repository actually implements. */
export type AuthzGrantsReadRepository = Pick<
  AuthzGrantRepository,
  | "findBinding"
  | "findCustomRole"
  | "findTeamOrganization"
  | "findProjectLineage"
  | "findOwnedApiKeys"
  | "findPersonalTeams"
>;

export type PrismaAuthzGrantDatabase = Pick<
  PrismaClient,
  "roleBinding" | "customRole" | "team" | "project" | "apiKey"
>;

/** A table the grant writes read and delete through, typed by the columns its readers select. */
export type WriteDelegate<Row = unknown> = {
  findFirst(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Row[]>;
  count(args: unknown): Promise<number>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  findUnique(args: unknown): Promise<Row | null>;
};

export type GrantWriteRecord = {
  id: string;
  principalId: string | null;
  createdAt: Date;
  revokedAt: Date | null;
};

export class PrismaAuthzGrantRepository implements AuthzGrantsReadRepository {
  static create(database: PrismaAuthzGrantDatabase): PrismaAuthzGrantRepository {
    return new PrismaAuthzGrantRepository(database);
  }

  private constructor(private readonly prisma: PrismaAuthzGrantDatabase) {}

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
  }): Promise<{ id: string; name: string }[]> {
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
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.team.findMany({
      where: { organizationId, isPersonal: true, ownerUserId: userId },
      select: { id: true, name: true },
    });
  }
}
