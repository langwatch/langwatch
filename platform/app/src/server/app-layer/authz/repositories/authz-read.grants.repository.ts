/**
 * ADR-092 delivery-plan PR 3 — the read repository a CUT-OVER organization
 * collects through: the same port as `authz-read.prisma.repository.ts`, over
 * the grants ledger's own projection (`Grant` / `Role`, plus `GrantUsage` for
 * share-link view accounting) instead of the compat `RoleBinding` /
 * `CustomRole` / `ShareLink` heads.
 *
 * The two implementations are deliberately independent rather than sharing a
 * base class: they answer the same questions of different tables, and each has
 * to be readable on its own for the cutover migration's decision-parity proof
 * to mean anything (it collects through both, explicitly, and compares every
 * decision). Where the query is genuinely the same one - membership and
 * lineage are not grants and were never projected - the duplication is a few
 * lines and the alternative is an inheritance seam nobody wants.
 *
 * Policy stays where it always was: this class returns stored facts, the
 * collector in @langwatch/authz-server decides what they mean.
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  RoleBindingScopeType,
  ShareableResourceKind,
} from "@langwatch/authz";
import type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationRole,
  ShareLinkRow,
} from "@langwatch/authz-server";
import type { Prisma } from "~/generated/prisma/client";
import { CUSTOM_ROLE_KIND } from "../../../role/role-kind";

/** The three scope tiers a `CollectedBinding` can carry. RESOURCE rows are
 *  the share tier (findShareLinks) and PLATFORM rows are dormant facts that
 *  no PR-3 decision reads, so neither belongs in a binding list. */
const BINDING_SCOPE_TYPES: readonly RoleBindingScopeType[] = [
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
];

/** `Grant.principalType` → the ShareLink audience the read port speaks.
 *  Mirrors `SHARE_VISIBILITY_BY_PRINCIPAL` in the ledger's projection
 *  mapping, from the DB's spelling rather than the ledger's. */
const SHARE_VISIBILITY_BY_PRINCIPAL_TYPE: Record<
  string,
  ShareLinkRow["visibility"] | undefined
> = {
  ANYONE: "PUBLIC",
  ORGANIZATION: "ORGANIZATION",
  PROJECT: "PROJECT",
};

/** `ShareableResourceKind` → the stored `Grant.resourceKind` spelling, which
 *  is ShareLink's own uppercase enum (the column inherits it). */
const RESOURCE_KIND_TO_DB: Record<
  ShareableResourceKind,
  ShareLinkRow["resourceType"]
> = {
  trace: "TRACE",
  thread: "THREAD",
};

export class GrantsAuthzReadRepository implements AuthzReadRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  /** Membership is not a grant: the same query the legacy repository runs. */
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
    // Current organization membership - not the grant row - is the tenancy
    // boundary, exactly as in the legacy repository: a grant naming a user who
    // has left the organization confers nothing. `Grant` is a projection with
    // no relation to `User` (plain columns by design, so the fold never
    // presumes another row exists), so the gate the legacy query expresses as
    // a relation filter is a membership read here. It is the same predicate,
    // and the engine's steps assume it either way.
    if (!(await this.isCurrentMember({ userId, organizationId }))) return [];
    const rows = await this.prisma.grant.findMany({
      where: {
        organizationId,
        principalType: "USER",
        principalId: userId,
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
      },
      select: { roleKey: true, scopeType: true, scopeId: true },
    });
    return collectBindings({ rows, viaGroupId: () => null });
  }

  async findGroupBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    // Same two-part gate the legacy group query carries: a GroupMembership row
    // outlives removal from the organization, so the group member must be a
    // CURRENT member, and the group itself must belong to this organization.
    if (!(await this.isCurrentMember({ userId, organizationId }))) return [];
    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId, group: { organizationId } },
      select: { groupId: true },
    });
    if (memberships.length === 0) return [];
    // One read for every group, not one per group: the grant carries the group
    // it names, which is the `viaGroupId` the collector needs stamped on each
    // binding.
    const rows = await this.prisma.grant.findMany({
      where: {
        organizationId,
        principalType: "GROUP",
        principalId: { in: memberships.map((row) => row.groupId) },
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
      },
      select: {
        roleKey: true,
        scopeType: true,
        scopeId: true,
        principalId: true,
      },
    });
    return collectBindings({ rows, viaGroupId: (row) => row.principalId });
  }

  async findApiKeyBindings({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    // No membership gate, for the reason the legacy repository gives: a key has
    // no OrganizationUser row of its own, and its owner's standing enters as
    // the §9 ceiling, computed elsewhere.
    const rows = await this.prisma.grant.findMany({
      where: {
        organizationId,
        principalType: "API_KEY",
        principalId: apiKeyId,
        scopeType: { in: [...BINDING_SCOPE_TYPES] },
      },
      select: { roleKey: true, scopeType: true, scopeId: true },
    });
    return collectBindings({ rows, viaGroupId: () => null });
  }

  /**
   * A cut-over organization has no legacy fallback by definition: its backfill
   * finalized (which switched the fallback off for it) before its cutover
   * could even be attempted, and the cutover imported every fact those rows
   * carried. Constant, not a query.
   */
  async findLegacyTeamMemberships(_args: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    return [];
  }

  /**
   * The `Role` head, fenced on the same two axes as the legacy `CustomRole`
   * query: the lookup is bounded to the organization being checked, so a
   * poisoned grant pointing at another organization's role reads as a missing
   * role; and an API key's private permission role backs only that key's own
   * grants.
   *
   * The second fence is a second query here rather than a relation filter.
   * `Role` is a projection with no relations (see `Grant`), so the legacy
   * `roleBindings: { some, every }` + `assignedUsers: { none: {} }` predicate -
   * "at least one grant on this role is mine, and every grant on it is mine" -
   * is evaluated over the grants that name the role. A user-principal grant on
   * a system role fails the `every` half exactly as an `assignedUsers` row did.
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
    if (customRoleIds.length === 0) return [];
    const apiKeyId = principal.type === "apiKey" ? principal.id : null;
    const rows = await this.prisma.role.findMany({
      where: {
        id: { in: [...customRoleIds] },
        organizationId,
        // A user, a group, or an anonymous caller may never carry a key's
        // private role at all; an API key may carry its own, checked below.
        ...(apiKeyId === null
          ? { kind: { not: CUSTOM_ROLE_KIND.SYSTEM_API_KEY } }
          : {}),
      },
      select: { id: true, permissions: true, kind: true },
    });
    const systemRoleIds = rows
      .filter((row) => row.kind === CUSTOM_ROLE_KIND.SYSTEM_API_KEY)
      .map((row) => row.id);
    if (systemRoleIds.length === 0 || apiKeyId === null) {
      return rows.map(({ id, permissions }) => ({ id, permissions }));
    }
    const exclusive = await this.rolesExclusiveToApiKey({
      organizationId,
      apiKeyId,
      roleIds: systemRoleIds,
    });
    return rows
      .filter(
        (row) =>
          row.kind !== CUSTOM_ROLE_KIND.SYSTEM_API_KEY || exclusive.has(row.id),
      )
      .map(({ id, permissions }) => ({ id, permissions }));
  }

  /** Membership again, not a grant: the legacy query, unchanged. */
  async findApiKeyOwner(
    apiKeyId: string,
  ): Promise<{ userId: string | null } | null> {
    return this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { userId: true },
    });
  }

  /**
   * Share links as RESOURCE grants. Token possession is IN the WHERE, as the
   * port demands - returning rows the request did not present would reopen the
   * trace-id-guessing hole - and the view budget arrives from `GrantUsage`,
   * whose writer is ShareService (delivery-plan decision 22). Prisma has no
   * relation between the two projections, so the join is a second read keyed
   * on the grant ids just found; a resource with no usage row has been viewed
   * zero times.
   *
   * The organization is resolved from the project first because the org
   * tenancy guard requires it: `Grant`'s only token-shaped bound is a single
   * `token: "..."` literal (the ADR-057 possession lookup), and this query
   * presents a LIST of tokens. Rather than widen that hatch to a list - which
   * would admit far more than this call needs - the lineage read the collector
   * already performs supplies the organizationId, and the query is bounded the
   * ordinary way.
   */
  async findShareLinks({
    projectId,
    tokens,
    links,
  }: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
  }): Promise<ShareLinkRow[]> {
    if (tokens.length === 0 || links.length === 0) return [];
    const lineage = await this.findProjectLineage({ projectId });
    if (!lineage) return [];
    const rows = await this.prisma.grant.findMany({
      where: {
        organizationId: lineage.organizationId,
        projectId,
        scopeType: "RESOURCE",
        token: { in: [...tokens] },
        OR: links.map((link) => ({
          resourceKind: RESOURCE_KIND_TO_DB[link.kind],
          scopeId: link.id,
        })),
      },
      select: {
        id: true,
        principalType: true,
        resourceKind: true,
        scopeId: true,
        projectId: true,
        expiresAt: true,
        maxViews: true,
      },
    });
    if (rows.length === 0) return [];
    const usages = await this.prisma.grantUsage.findMany({
      where: { grantId: { in: rows.map((row) => row.id) } },
      select: { grantId: true, viewCount: true },
    });
    const viewCounts = new Map(
      usages.map((usage) => [usage.grantId, usage.viewCount]),
    );
    const shareLinks: ShareLinkRow[] = [];
    for (const row of rows) {
      const visibility = SHARE_VISIBILITY_BY_PRINCIPAL_TYPE[row.principalType];
      // A RESOURCE grant naming a user, a group, a team or a key is a share
      // audience `ShareVisibility` cannot express, so the legacy shim never
      // answered for it either. Skipped silently: a shape the compat head
      // never held is not a failure.
      if (!visibility) continue;
      if (row.resourceKind !== "TRACE" && row.resourceKind !== "THREAD") {
        continue;
      }
      if (row.projectId == null) continue;
      shareLinks.push({
        resourceType: row.resourceKind,
        resourceId: row.scopeId,
        projectId: row.projectId,
        visibility,
        expiresAt: row.expiresAt,
        maxViews: row.maxViews,
        viewCount: viewCounts.get(row.id) ?? 0,
      });
    }
    return shareLinks;
  }

  /** Lineage is not a grant: the legacy query, unchanged. */
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

  /** Lineage is not a grant: the legacy query, unchanged. */
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

  private async isCurrentMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { userId: true },
    });
    return membership !== null;
  }

  /**
   * The role ids among `roleIds` that this API key - and only this API key -
   * holds a grant for. The `some` half of the legacy predicate matters as much
   * as the `every` half: Prisma's `every` is vacuously true over an empty
   * relation, so a system role with NO grants at all would otherwise be
   * readable by every key on the platform.
   */
  private async rolesExclusiveToApiKey({
    organizationId,
    apiKeyId,
    roleIds,
  }: {
    organizationId: string;
    apiKeyId: string;
    roleIds: readonly string[];
  }): Promise<Set<string>> {
    const holders = await this.prisma.grant.findMany({
      where: {
        organizationId,
        roleKey: { in: roleIds.map((roleId) => `custom:${roleId}`) },
      },
      select: { roleKey: true, principalType: true, principalId: true },
    });
    const held = new Map<string, { mine: boolean; foreign: boolean }>();
    for (const holder of holders) {
      const role = bindingRole(holder.roleKey);
      if (role?.customRoleId == null) continue;
      const entry = held.get(role.customRoleId) ?? {
        mine: false,
        foreign: false,
      };
      if (
        holder.principalType === "API_KEY" &&
        holder.principalId === apiKeyId
      ) {
        entry.mine = true;
      } else {
        entry.foreign = true;
      }
      held.set(role.customRoleId, entry);
    }
    return new Set(
      [...held.entries()]
        .filter(([, entry]) => entry.mine && !entry.foreign)
        .map(([roleId]) => roleId),
    );
  }
}

/**
 * `roleKey` → `CollectedBinding`, the inverse of `roleKeyForTeamRole` in
 * @langwatch/authz and the same translation the ledger's projection mapping
 * performs onto the compat head: admin→ADMIN, member→MEMBER, viewer→VIEWER,
 * custom:<id>→(CUSTOM, id).
 *
 * A row this cannot translate - `lite-member`, a null key (RESOURCE and
 * PLATFORM rows), anything else - is SKIPPED, not defaulted. Those are the
 * dormant head-only facts the cutover imports (PR3_DESIGN.md, the dormant-fact
 * principle): they are stored so contract can make them load-bearing, and
 * until then their decisions are still inferred from membership by the engine's
 * org-role floor, exactly as they were before the cutover. Translating one into
 * a binding here would change a decision the cutover promised not to change.
 */
function collectBindings<
  TRow extends { roleKey: string | null; scopeType: string; scopeId: string },
>({
  rows,
  viaGroupId,
}: {
  rows: readonly TRow[];
  viaGroupId: (row: TRow) => string | null;
}): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  for (const row of rows) {
    if (!isBindingScope(row.scopeType)) continue;
    const role = bindingRole(row.roleKey);
    if (!role) continue;
    bindings.push({
      role: role.role,
      customRoleId: role.customRoleId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      viaGroupId: viaGroupId(row),
    });
  }
  return bindings;
}

function bindingRole(
  roleKey: string | null,
): { role: CollectedBinding["role"]; customRoleId: string | null } | null {
  if (roleKey === "admin") return { role: "ADMIN", customRoleId: null };
  if (roleKey === "member") return { role: "MEMBER", customRoleId: null };
  if (roleKey === "viewer") return { role: "VIEWER", customRoleId: null };
  if (roleKey?.startsWith("custom:")) {
    return { role: "CUSTOM", customRoleId: roleKey.slice("custom:".length) };
  }
  return null;
}

function isBindingScope(scopeType: string): scopeType is RoleBindingScopeType {
  return (BINDING_SCOPE_TYPES as readonly string[]).includes(scopeType);
}
