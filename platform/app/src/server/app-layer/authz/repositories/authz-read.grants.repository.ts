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
import {
  RESOURCE_KIND_TO_DB,
  SHARE_VISIBILITY_BY_PRINCIPAL_DB,
} from "@langwatch/authz-server";
import type { Prisma } from "~/generated/prisma/client";
import { CUSTOM_ROLE_KIND } from "../../../role/role-kind";
import { liveGrants, liveRoles } from "./live-rows";

/** The three scope tiers a `CollectedBinding` can carry. RESOURCE rows are
 *  the share tier (findShareLinks) and PLATFORM rows are dormant facts that
 *  no PR-3 decision reads, so neither belongs in a binding list. */
const BINDING_SCOPE_TYPES: readonly RoleBindingScopeType[] = [
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
];

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
    const rows = await liveGrants(this.prisma).findMany({
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
    const rows = await liveGrants(this.prisma).findMany({
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
    const rows = await liveGrants(this.prisma).findMany({
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
   * The same `TeamUser` read the legacy repository performs, on purpose. The
   * rows live until contract deletes them, and the engine's org-level union
   * quirk keeps inferring organization-scope answers from them — the
   * dormant-fact principle (delivery plan decision 13): the genesis-minted
   * org-member floor grant that will replace the union is stored but not yet
   * load-bearing, so the inference must keep running IDENTICALLY over both
   * heads. Returning nothing here made the two readers disagree at
   * organization scope for every ordinary member, which no parity proof
   * could ever clear. The quirk, the rows and this read all retire together
   * at contract.
   */
  async findLegacyTeamMemberships({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    const rows = await this.prisma.teamUser.findMany({
      // A stale cross-org TeamUser row must not confer access any more than a
      // stale grant: the team belongs to the organization AND the user is a
      // current member of it (legacy parity, rbac.ts's TeamUser fallback).
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
    });
    return rows.map((row) => ({
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId ?? null,
      isPersonal: row.team.isPersonal,
    }));
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
    const rows = await liveRoles(this.prisma).findMany({
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
   *
   * `organizationId` is OPTIONAL and exists only so a caller who has already
   * resolved the project's lineage (`CutoverAwareAuthzReadRepository`, which
   * reads it to decide which head to ask) can hand it straight over instead
   * of this method resolving it again - the same row, read twice per
   * share-link check otherwise. A caller with no lineage of its own still
   * gets the fallback resolve.
   */
  async findShareLinks({
    projectId,
    tokens,
    links,
    organizationId,
  }: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
    organizationId?: string;
  }): Promise<ShareLinkRow[]> {
    if (tokens.length === 0 || links.length === 0) return [];
    const resolvedOrganizationId =
      organizationId ??
      (await this.findProjectLineage({ projectId }))?.organizationId;
    if (!resolvedOrganizationId) return [];

    const rows = await this.findResourceGrantCandidates({
      organizationId: resolvedOrganizationId,
      projectId,
      tokens,
      links,
    });
    if (rows.length === 0) return [];

    const viewCounts = await this.findViewCounts({
      organizationId: resolvedOrganizationId,
      grantIds: rows.map((row) => row.id),
    });
    return rows.flatMap((row) => shareLinkRowFrom({ row, viewCounts }));
  }

  /** The RESOURCE grants a share-link check may match: possession (the
   *  presented tokens) AND one of the presented resource links. */
  private async findResourceGrantCandidates({
    organizationId,
    projectId,
    tokens,
    links,
  }: {
    organizationId: string;
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
  }): Promise<ShareLinkGrantCandidateRow[]> {
    return liveGrants(this.prisma).findMany({
      where: {
        organizationId,
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
  }

  /** The view budget lives on its own table (decision 22); a resource with no
   *  usage row has been viewed zero times. The organization bounds the read:
   *  a grant-id LIST alone is only as tenant-scoped as its weakest entry, so
   *  the tenancy guard refuses it without the organization named. */
  private async findViewCounts({
    organizationId,
    grantIds,
  }: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<Map<string, number>> {
    const usages = await this.prisma.grantUsage.findMany({
      where: { organizationId, grantId: { in: [...grantIds] } },
      select: { grantId: true, viewCount: true },
    });
    return new Map(usages.map((usage) => [usage.grantId, usage.viewCount]));
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
    const holders = await liveGrants(this.prisma).findMany({
      where: {
        organizationId,
        roleKey: { in: roleIds.map((roleId) => `custom:${roleId}`) },
      },
      select: { roleKey: true, principalType: true, principalId: true },
    });
    const held = new Map<string, { isMine: boolean; isForeign: boolean }>();
    for (const holder of holders) {
      const role = bindingRole(holder.roleKey);
      if (role?.customRoleId == null) continue;
      const entry = held.get(role.customRoleId) ?? {
        isMine: false,
        isForeign: false,
      };
      if (
        holder.principalType === "API_KEY" &&
        holder.principalId === apiKeyId
      ) {
        entry.isMine = true;
      } else {
        entry.isForeign = true;
      }
      held.set(role.customRoleId, entry);
    }
    return new Set(
      [...held.entries()]
        .filter(([, entry]) => entry.isMine && !entry.isForeign)
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
 * A row this cannot translate - `lite-member`, `legacy-admin`, a null key
 * (RESOURCE and PLATFORM rows), anything else - is SKIPPED, not defaulted. Those are the
 * dormant head-only facts the cutover imports (dev/docs/adr/110-grant-aggregates-are-grants.md,
 * decision 13, the dormant-fact principle): they are stored so contract can make them load-bearing, and
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

/** The columns `findResourceGrantCandidates` selects off `Grant`. */
type ShareLinkGrantCandidateRow = {
  id: string;
  principalType: string;
  resourceKind: string | null;
  scopeId: string;
  projectId: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
};

/**
 * One `Grant` candidate row → the `ShareLinkRow` the port speaks, or nothing
 * when the row is a shape the legacy shim never held. Three independent
 * reasons a row is skipped rather than translated - an audience
 * `ShareVisibility` cannot express, a resource kind that is not TRACE or
 * THREAD, or no project - each of them silent: skipping is not a failure
 * here, it is a row `findShareLinks`'s WHERE admitted that this port simply
 * never answers for.
 */
function shareLinkRowFrom({
  row,
  viewCounts,
}: {
  row: ShareLinkGrantCandidateRow;
  viewCounts: Map<string, number>;
}): ShareLinkRow[] {
  const visibility = SHARE_VISIBILITY_BY_PRINCIPAL_DB[row.principalType];
  if (!visibility) return [];
  if (row.resourceKind !== "TRACE" && row.resourceKind !== "THREAD") return [];
  if (row.projectId == null) return [];
  return [
    {
      resourceType: row.resourceKind,
      resourceId: row.scopeId,
      projectId: row.projectId,
      visibility,
      expiresAt: row.expiresAt,
      maxViews: row.maxViews,
      viewCount: viewCounts.get(row.id) ?? 0,
    },
  ];
}
