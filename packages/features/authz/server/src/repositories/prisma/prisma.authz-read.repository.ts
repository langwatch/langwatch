/**
 * ADR-092 — the Prisma implementation of AuthzReadRepository: every query
 * COLLECT runs, and nothing else. Policy (group expansion semantics, the
 * lenient custom-role parse, share-link liveness) lives in
 * the AuthZ collector; this class returns stored facts.
 *
 * Constructed over a transaction handle too - the offboarding proof binds
 * one of these to the deleting transaction so the re-collect sees the
 * deletes (ADR-092 §10 step 7).
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  ShareableResourceKind,
} from "@langwatch/authz-contract";
import type {
  CustomRolePermissionsRow,
  OrganizationRole,
  ShareLinkRow,
} from "../authz-read.repository";
import { AuthzReadRepository, type AuthzDatabase } from "../authz-read.repository";

const SYSTEM_API_KEY_ROLE_KIND = "system_api_key" as const;

export class PrismaAuthzReadRepository extends AuthzReadRepository {
  static create(database: AuthzDatabase): PrismaAuthzReadRepository {
    return new PrismaAuthzReadRepository(database);
  }

  private constructor(private readonly database: AuthzDatabase) {
    super();
  }

  beginPass(): AuthzReadRepository {
    return this;
  }

  async tryFindOrganizationRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    const row = (await this.database.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { role: true },
    })) as { role: OrganizationRole } | null;
    return row?.role ?? null;
  }

  async findUserBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = (await this.database.roleBinding.findMany({
      // Current organization membership - not the binding row - is the
      // tenancy boundary: a binding naming a user who has left the
      // organization confers nothing. Same predicate the legacy resolvers
      // carry (rbac.ts checkPermissionFromBindings, role-binding-resolver.ts
      // collectBindingsForUser).
      where: {
        organizationId,
        userId,
        user: { orgMemberships: { some: { organizationId } } },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    })) as Array<{
      role: CollectedBinding["role"];
      customRoleId: string | null;
      scopeType: CollectedBinding["scopeType"];
      scopeId: string;
    }>;
    return rows.map((row) => ({ ...row, viaGroupId: null }));
  }

  async findGroupBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = (await this.database.roleBinding.findMany({
      // A GroupMembership row outlives removal from the organization, so the
      // group member carries the same current-membership gate as a direct
      // binding - without it an offboarded user keeps whatever their groups
      // granted.
      where: {
        organizationId,
        group: {
          members: {
            some: {
              userId,
              user: { orgMemberships: { some: { organizationId } } },
            },
          },
        },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
        groupId: true,
      },
    })) as Array<{
      role: CollectedBinding["role"];
      customRoleId: string | null;
      scopeType: CollectedBinding["scopeType"];
      scopeId: string;
      groupId: string | null;
    }>;
    return rows.map(({ groupId, ...row }) => ({ ...row, viaGroupId: groupId }));
  }

  async findApiKeyBindings({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    const rows = (await this.database.roleBinding.findMany({
      where: { organizationId, apiKeyId },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    })) as Array<{
      role: CollectedBinding["role"];
      customRoleId: string | null;
      scopeType: CollectedBinding["scopeType"];
      scopeId: string;
    }>;
    return rows.map((row) => ({ ...row, viaGroupId: null }));
  }

  async findLegacyTeamMemberships({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    // No per-organization switch: the rows participate for EVERY
    // organization until contract deletes them. Stage B's finalization
    // proves the promoted bindings answer identically at the scopes they
    // replace; the org-level union quirk keeps inferring from these rows on
    // both heads until its replacement (the genesis-minted floor grant)
    // becomes load-bearing at contract.
    const rows = (await this.database.teamUser.findMany({
      // A stale cross-org TeamUser row must not confer access any more than a
      // stale RoleBinding: the team belongs to the organization AND the user
      // is a current member of it (legacy parity, rbac.ts's TeamUser
      // fallback).
      where: {
        userId,
        team: {
          organizationId,
          organization: { members: { some: { userId } } },
        },
      },
      select: {
        teamId: true,
        role: true,
        assignedRoleId: true,
        team: { select: { isPersonal: true } },
      },
    })) as Array<{
      teamId: string;
      role: LegacyTeamMembership["role"];
      assignedRoleId: string | null;
      team: { isPersonal: boolean };
    }>;
    return rows.map((row) => ({
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId ?? null,
      isPersonal: row.team.isPersonal,
    }));
  }

  /**
   * Defense in depth on two axes, both mirroring the legacy resolvers: the
   * lookup is fenced to the organization being checked, so a poisoned binding
   * pointing at another organization's role reads as a missing role; and an
   * API key's private permission role backs only that key's own bindings
   * (see systemRoleGuard below).
   */
  async findCustomRolePermissions({
    organizationId,
    principal,
    customRoleIds,
  }: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]> {
    return (await this.database.customRole.findMany({
      where: {
        id: { in: [...customRoleIds] },
        organizationId,
        ...this.systemRoleGuard(principal),
      },
      select: { id: true, permissions: true },
    })) as CustomRolePermissionsRow[];
  }

  /**
   * `{ userId: null }` is a service key - it exists and has no owner, so the
   * §9 ceiling does not apply to it; `null` is a key that is not there at all.
   */
  async tryFindApiKeyOwner(apiKeyId: string): Promise<{ userId: string | null } | null> {
    return (await this.database.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { userId: true },
    })) as { userId: string | null } | null;
  }

  async findShareLinks({
    projectId,
    tokens,
    links,
  }: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
  }): Promise<ShareLinkRow[]> {
    return (await this.database.shareLink.findMany({
      where: {
        projectId,
        token: { in: [...tokens] },
        OR: links.map((link) => ({
          resourceType: link.kind === "trace" ? ("TRACE" as const) : ("THREAD" as const),
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
    })) as ShareLinkRow[];
  }

  async tryFindProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> {
    const project = (await this.database.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true, organizationId: true } } },
    })) as { team: { id: string; organizationId: string } } | null;
    if (!project?.team) return null;
    return {
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  }

  async tryFindTeamOrganization({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    const team = (await this.database.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    })) as { organizationId: string } | null;
    return team ?? null;
  }

  /** Keeps an API key's private permission role with the key it was minted
   * for. The `some` clause prevents Prisma's vacuous `every` from admitting
   * an unassigned system role. */
  private systemRoleGuard(principal: AuthzPrincipalRef): Record<string, unknown> {
    if (principal.type !== "apiKey") {
      return { kind: { not: SYSTEM_API_KEY_ROLE_KIND } };
    }
    return {
      OR: [
        { kind: { not: SYSTEM_API_KEY_ROLE_KIND } },
        {
          roleBindings: {
            some: { apiKeyId: principal.id },
            every: { apiKeyId: principal.id },
          },
          assignedUsers: { none: {} },
        },
      ],
    };
  }
}
