/**
 * Runtime authorization reader backed by the grants projection (`Grant` /
 * `Role`, plus `GrantUsage` for share-link view accounting). Membership and
 * lineage remain direct reads because they are not grant facts.
 *
 * The migration keeps its legacy repository separately for parity. Shared
 * membership and lineage queries remain small direct reads.
 *
 * Policy stays where it always was: this class returns stored facts, the
 * collector in @langwatch/authz-server decides what they mean.
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  RoleBindingScopeType,
  ShareableResourceKind,
} from "@langwatch/authz";
import type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationMembership,
  ShareLinkRow,
} from "@langwatch/authz-server";
import {
  grantRowToFact,
  isBindingGrant,
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

const GRANT_ROW_SELECT = {
  id: true,
  organizationId: true,
  principalType: true,
  principalId: true,
  roleKey: true,
  legacyRole: true,
  source: true,
  scopeType: true,
  scopeId: true,
  token: true,
  permission: true,
  resourceKind: true,
  projectId: true,
  createdByUserId: true,
  expiresAt: true,
  maxViews: true,
  occurredAt: true,
} as const satisfies Prisma.GrantSelect;

type BindingGrantRow = Prisma.GrantGetPayload<{
  select: typeof GRANT_ROW_SELECT;
}>;

export class GrantsAuthzReadRepository implements AuthzReadRepository {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  /** Membership is not a grant: the same query the legacy repository runs. */
  async findOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationMembership | null> {
    const row = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { role: true, disabledAt: true },
    });
    if (!row) return null;
    return { role: row.role, disabled: row.disabledAt !== null };
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
      select: GRANT_ROW_SELECT,
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
      select: GRANT_ROW_SELECT,
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
      select: GRANT_ROW_SELECT,
    });
    return collectBindings({ rows, viaGroupId: () => null });
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
   * resolved the project's lineage can hand it straight over instead of this
   * method resolving it again - the same row, read twice per share-link check
   * otherwise. A caller with no lineage of its own still gets the resolve.
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
    // `disabledAt: null` is part of the predicate, not a refinement of it: a
    // seat-disabled membership confers no grants, exactly as a removed one
    // does. This is the ledger-head twin of the relation fence the legacy
    // repository puts on each binding query.
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId, disabledAt: null },
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
      select: GRANT_ROW_SELECT,
    });
    const held = new Map<string, { isMine: boolean; isForeign: boolean }>();
    for (const holder of holders) {
      const grant = grantRowToFact(holder);
      if (!isBindingGrant(grant)) continue;
      if (!grant.roleKey.startsWith("custom:")) continue;
      const roleId = grant.roleKey.slice("custom:".length);
      const entry = held.get(roleId) ?? {
        isMine: false,
        isForeign: false,
      };
      if (
        grant.principal.type === "apiKey" &&
        grant.principal.id === apiKeyId
      ) {
        entry.isMine = true;
      } else {
        entry.isForeign = true;
      }
      held.set(roleId, entry);
    }
    return new Set(
      [...held.entries()]
        .filter(([, entry]) => entry.isMine && !entry.isForeign)
        .map(([roleId]) => roleId),
    );
  }
}

/**
 * Translate grant roles the current decision API can represent. Facts such as
 * lite-member and legacy-admin remain migration data or membership-derived
 * policy and are not invented as binding rows.
 */
function collectBindings<TRow extends BindingGrantRow>({
  rows,
  viaGroupId,
}: {
  rows: readonly TRow[];
  viaGroupId: (row: TRow) => string | null;
}): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  for (const row of rows) {
    const grant = grantRowToFact(row);
    if (!isBindingGrant(grant)) continue;
    bindings.push({
      roleKey: grant.roleKey,
      scopeType: grant.scope.type,
      scopeId: grant.scope.id,
      viaGroupId: viaGroupId(row),
    });
  }
  return bindings;
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
