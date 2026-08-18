import { generate } from "@langwatch/ksuid";
import {
  type PrismaClient,
  RoleBindingScopeType,
  type Team,
  type TeamUserRole,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  type LedgerActor,
} from "~/server/app-layer/authz/ledger";
import { KSUID_RESOURCES } from "~/utils/constants";
import type {
  CreateTeamInput,
  PaginatedResult,
  TeamRepository,
  UpdateTeamInput,
} from "./team.repository";

export class PrismaTeamRepository implements TeamRepository {
  constructor(
    private readonly prisma: PrismaClient,
    // Team memberships are grants, and the ledger is their only writer since
    // ADR-092 delivery-plan PR 2. Injectable so a test can watch the commands
    // rather than the tables they end up in.
    private readonly writer: GrantsLedgerWriter = grantsLedgerWriter(),
  ) {}

  async findById(id: string): Promise<Team | null> {
    return this.prisma.team.findUnique({ where: { id } });
  }

  async findAllByOrganization({
    organizationId,
    page,
    limit,
  }: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Team>> {
    const where = { organizationId, archivedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.team.count({ where }),
    ]);
    return { data, pagination: { page, limit, total } };
  }

  async findBySlugInOrganization({
    slug,
    organizationId,
  }: {
    slug: string;
    organizationId: string;
  }): Promise<Team | null> {
    return this.prisma.team.findFirst({
      where: { slug, organizationId, archivedAt: null },
    });
  }

  async create(data: CreateTeamInput): Promise<Team> {
    return this.prisma.team.create({ data });
  }

  async update({
    id,
    organizationId,
    data,
  }: {
    id: string;
    organizationId: string;
    data: UpdateTeamInput;
  }): Promise<Team | null> {
    const where = { id, organizationId, archivedAt: null };
    const result = await this.prisma.team.updateMany({ where, data });
    if (result.count === 0) return null;
    return this.prisma.team.findUnique({ where: { id } });
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Team | null> {
    const where = { id, organizationId, archivedAt: null };
    const result = await this.prisma.team.updateMany({
      where,
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.prisma.team.findUnique({ where: { id } });
  }

  async isUserInOrganization({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
      select: { userId: true },
    });
    return membership !== null;
  }

  async grantMembership({
    teamId,
    organizationId,
    userId,
    role,
    actor,
  }: {
    teamId: string;
    organizationId: string;
    userId: string;
    role: TeamUserRole;
    actor: LedgerActor;
  }): Promise<void> {
    await this.writer.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId },
          role,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
      ],
      actor,
      onDuplicate: "reject",
    });
  }

  async revokeMembership({
    teamId,
    organizationId,
    userId,
    actor,
  }: {
    teamId: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<number> {
    return this.writer.revokeBindingsWhere({
      organizationId,
      where: {
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        userId,
      },
      actor,
    });
  }
}
