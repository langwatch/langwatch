/**
 * ADR-092 — the Prisma implementation of AuthzReadRepository: every query
 * COLLECT runs, and nothing else. Policy (group expansion semantics, the
 * lenient custom-role parse, share-link liveness) lives in
 * @langwatch/authz-server's collector; this class returns stored facts.
 *
 * Constructed over a transaction handle too - the offboarding proof binds
 * one of these to the deleting transaction so the re-collect sees the
 * deletes (ADR-092 §10 step 7).
 */
import type { CollectedBinding, LegacyTeamMembership } from "@langwatch/authz";
import type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationRole,
  ShareLinkRow,
} from "@langwatch/authz-server";
import type { Prisma } from "@prisma/client";

export class PrismaAuthzReadRepository implements AuthzReadRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async findOrganizationRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    const row = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { role: true },
    });
    return row?.role ?? null;
  }

  async findUserBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
    return rows.map((row) => ({ ...row, viaGroupId: null }));
  }

  async findGroupBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        group: { members: { some: { userId } } },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
        groupId: true,
      },
    });
    return rows.map(({ groupId, ...row }) => ({ ...row, viaGroupId: groupId }));
  }

  async findApiKeyBindings({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: { organizationId, apiKeyId },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
    return rows.map((row) => ({ ...row, viaGroupId: null }));
  }

  async findLegacyTeamMemberships({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    const rows = await this.prisma.teamUser.findMany({
      where: { userId, team: { organizationId } },
      select: {
        teamId: true,
        role: true,
        assignedRoleId: true,
        team: { select: { isPersonal: true } },
      },
    });
    return rows.map((row) => ({
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId ?? null,
      isPersonal: row.team.isPersonal,
    }));
  }

  async findCustomRolePermissions({
    customRoleIds,
  }: {
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]> {
    return this.prisma.customRole.findMany({
      where: { id: { in: [...customRoleIds] } },
      select: { id: true, permissions: true },
    });
  }

  async findShareLinks({
    projectId,
    tokens,
    links,
  }: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: "trace" | "thread"; id: string }>;
  }): Promise<ShareLinkRow[]> {
    return this.prisma.shareLink.findMany({
      where: {
        projectId,
        token: { in: [...tokens] },
        OR: links.map((link) => ({
          resourceType:
            link.kind === "trace" ? ("TRACE" as const) : ("THREAD" as const),
          resourceId: link.id,
        })),
      },
      select: {
        resourceType: true,
        resourceId: true,
        projectId: true,
        visibility: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
      },
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

  async findTeamOrganization({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team ?? null;
  }
}
