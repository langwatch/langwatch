// Prisma queries only; policy and liveness belong to collector.
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  ShareableResourceKind,
} from "@langwatch/authz-contract";
import type {
  CustomRolePermissionsRow,
  OrganizationMembership,
  OrganizationRole,
  ShareLinkRow,
} from "../authz-read.repository.ts";
import { AuthzReadRepository, type AuthzDatabase } from "../authz-read.repository.ts";
import { fromDate } from "@langwatch/time";

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

  async findOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationMembership | null> {
    const row = (await this.database.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { role: true, disabledAt: true },
    })) as { role: OrganizationRole; disabledAt: Date | null } | null;
    // `disabledAt` is SELECTED, not filtered: the row is a stored fact and the
    // collector applies the policy. Filtering here would report a disabled
    // membership as absent, and the denial could then only say "not a member"
    // of someone who is one.
    if (!row) return null;
    // `!== null`, not `!= null`: a row that arrives without the column at all
    // reads as DISABLED. That can only happen if someone drops `disabledAt`
    // from the select above, and between a loud lockout and a silent return
    // of everyone's access, the lockout is the one that gets noticed.
    return { role: row.role, disabled: row.disabledAt !== null };
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
      // tenancy boundary: a binding naming a user who left, or whose seat
      // was disabled, confers nothing. Same predicate the legacy resolvers
      // carry (rbac.ts, role-binding-resolver.ts).
      where: {
        organizationId,
        userId,
        user: {
          orgMemberships: { some: { organizationId, disabledAt: null } },
        },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    })) as {
      role: CollectedBinding["role"];
      customRoleId: string | null;
      scopeType: CollectedBinding["scopeType"];
      scopeId: string;
    }[];
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
              user: {
                orgMemberships: { some: { organizationId, disabledAt: null } },
              },
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
    })) as {
      role: CollectedBinding["role"];
      customRoleId: string | null;
      scopeType: CollectedBinding["scopeType"];
      scopeId: string;
      groupId: string | null;
    }[];
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
    })) as {
      role: CollectedBinding["role"];
      customRoleId: string | null;
      scopeType: CollectedBinding["scopeType"];
      scopeId: string;
    }[];
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
    // replace, until the genesis-minted floor grant becomes load-bearing.
    const rows = (await this.database.teamUser.findMany({
      // A stale cross-org TeamUser row must not confer access any more than a
      // stale RoleBinding: the team belongs to the organization AND the user
      // is a current member of it (legacy parity, rbac.ts's TeamUser
      // fallback).
      where: {
        userId,
        team: {
          organizationId,
          organization: { members: { some: { userId, disabledAt: null } } },
        },
      },
      select: {
        teamId: true,
        role: true,
        assignedRoleId: true,
        team: { select: { isPersonal: true } },
      },
    })) as {
      teamId: string;
      role: LegacyTeamMembership["role"];
      assignedRoleId: string | null;
      team: { isPersonal: boolean };
    }[];
    return rows.map((row) => ({
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId ?? null,
      isPersonal: row.team.isPersonal,
    }));
  }

  /**
   * Defense in depth: the lookup is fenced to the organization being
   * checked, so a poisoned binding pointing elsewhere reads as missing;
   * an API key's private role backs only that key's own bindings.
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
  async findApiKeyOwner(apiKeyId: string): Promise<{ userId: string | null } | null> {
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
    links: readonly { kind: ShareableResourceKind; id: string }[];
  }): Promise<ShareLinkRow[]> {
    const rows = (await this.database.shareLink.findMany({
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
    })) as (Omit<ShareLinkRow, "expiresAt"> & { expiresAt: Date | null })[];

    return rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt === null ? null : fromDate(row.expiresAt),
    }));
  }

  async findProjectLineage({
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

  async findTeamOrganization({
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
