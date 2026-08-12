/**
 * ADR-092 §2 — COLLECT: the policy half of reading authorization data. The
 * queries live behind AuthzReadRepository (the app's Prisma implementation);
 * this service owns what the rows MEAN: group expansion, the lenient
 * custom-role parse, share-link liveness, audience mapping, and scope
 * resolution. One snapshot per (principal, organization) feeds any number
 * of pure decide() calls.
 */
import type {
  AuthzPrincipalRef,
  AuthzScopeRef,
  CollectedGrants,
  GrantAudience,
  ResourceGrant,
  ShareableResourceKind,
} from "@langwatch/authz";
import type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  ShareLinkRow,
} from "./authz-read.repository";

export class AuthzCollectorService {
  constructor(private readonly reader: AuthzReadRepository) {}

  /**
   * Resolve a scope reference from the ids a request carries. Project ids
   * are resolved to their owning team + organization (the tenant comes from
   * the resource, never from the caller — same posture as the legacy
   * project path). Returns null when the id does not exist.
   */
  async resolveScopeRef({
    projectId,
    teamId,
    organizationId,
  }: {
    projectId?: string;
    teamId?: string;
    organizationId?: string;
  }): Promise<AuthzScopeRef | null> {
    if (projectId) {
      const lineage = await this.reader.findProjectLineage({ projectId });
      if (!lineage) return null;
      return {
        type: "project",
        id: projectId,
        teamId: lineage.teamId,
        organizationId: lineage.organizationId,
      };
    }
    if (teamId) {
      const team = await this.reader.findTeamOrganization({ teamId });
      if (!team) return null;
      return { type: "team", id: teamId, organizationId: team.organizationId };
    }
    if (organizationId) {
      return { type: "organization", id: organizationId };
    }
    return null;
  }

  /**
   * Resolve a resource-tier scope from a stored resource's own facts.
   *
   * What this method verifies: the project's team/organization lineage is
   * read from storage here, never taken from the request - same posture as
   * resolveScopeRef. What it CANNOT verify: that `id` lives in `projectId`,
   * and that `parentThreadId` is the trace's own thread - traces live in
   * ClickHouse. Both anchors MUST come off the stored row the caller
   * already fetched (that read is scoped by projectId, which is what
   * enforces them). Passing request input for either reopens the
   * forged-parent hole: one shared thread would unlock unrelated traces
   * through the parent link. Returns null when the project does not exist.
   */
  async resolveResourceScopeRef({
    projectId,
    kind,
    id,
    parentThreadId,
    shareTokens,
  }: {
    projectId: string;
    kind: ShareableResourceKind;
    id: string;
    parentThreadId?: string;
    shareTokens?: readonly string[];
  }): Promise<AuthzScopeRef | null> {
    const lineage = await this.reader.findProjectLineage({ projectId });
    if (!lineage) return null;
    return {
      type: "resource",
      kind,
      id,
      parents:
        kind === "trace" && parentThreadId
          ? [{ kind: "thread", id: parentThreadId }]
          : undefined,
      shareTokens,
      projectId,
      teamId: lineage.teamId,
      organizationId: lineage.organizationId,
    };
  }

  async collectGrants({
    principal,
    organizationId,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
  }): Promise<CollectedGrants> {
    switch (principal.type) {
      case "anonymous":
        // No session, no queries: an anonymous caller holds nothing except
        // what resource grants with the `anyone` audience give at decide
        // time.
        return {
          principal,
          organizationId,
          organizationRole: null,
          isOrgMember: false,
          bindings: [],
          legacyTeamMemberships: [],
          customRolePermissions: new Map(),
        };
      case "apiKey":
        return this.collectApiKeyGrants({ principal, organizationId });
      case "user":
        return this.collectUserGrants({ principal, organizationId });
    }
  }

  /**
   * ADR-092 §8 / stage A5 — resource-tier grants for a resource scope's
   * links (the resource itself plus shareable ancestors).
   *
   * SHIM: storage is the ADR-057 `ShareLink` table, read as grants of
   * `traces:view` with the audience its visibility implies. Two ADR-057
   * invariants are preserved here: possession of the token — not row
   * existence — is what activates a grant (no presented tokens, no reads,
   * no grants), and liveness (expiry, view budget) is filtered before the
   * engine ever sees a row. View CONSUMPTION stays in ShareService: this
   * reader is pure. The C5 migration extends ShareLink into full
   * ResourceGrant storage (per-row permission, principal audiences) rather
   * than adding a parallel table.
   */
  async collectResourceGrants({
    scope,
  }: {
    scope: AuthzScopeRef;
  }): Promise<ResourceGrant[]> {
    if (scope.type !== "resource") return [];
    if (!scope.shareTokens || scope.shareTokens.length === 0) return [];
    const links = [
      { kind: scope.kind, id: scope.id },
      ...(scope.parents ?? []),
    ];
    const rows = await this.reader.findShareLinks({
      projectId: scope.projectId,
      tokens: scope.shareTokens,
      links,
    });
    const now = new Date();
    return rows
      .filter((row) => isLiveShareLink(row, now))
      .map((row) => ({
        kind:
          row.resourceType === "TRACE"
            ? ("trace" as const)
            : ("thread" as const),
        id: row.resourceId,
        projectId: row.projectId,
        permission: "traces:view",
        audience: audienceForVisibility({
          visibility: row.visibility,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
        }),
      }));
  }

  private async collectApiKeyGrants({
    principal,
    organizationId,
  }: {
    principal: Extract<AuthzPrincipalRef, { type: "apiKey" }>;
    organizationId: string;
  }): Promise<CollectedGrants> {
    const bindings = await this.reader.findApiKeyBindings({
      apiKeyId: principal.id,
      organizationId,
    });
    return {
      principal,
      organizationId,
      organizationRole: null,
      isOrgMember: false,
      bindings,
      legacyTeamMemberships: [],
      customRolePermissions: await this.prefetchCustomRolePermissions(
        dedupeCustomRoleIds(bindings, []),
      ),
    };
  }

  private async collectUserGrants({
    principal,
    organizationId,
  }: {
    principal: Extract<AuthzPrincipalRef, { type: "user" }>;
    organizationId: string;
  }): Promise<CollectedGrants> {
    const [organizationRole, directBindings, groupBindings, legacyRows] =
      await Promise.all([
        this.reader.findOrganizationRole({
          userId: principal.id,
          organizationId,
        }),
        this.reader.findUserBindings({ userId: principal.id, organizationId }),
        this.reader.findGroupBindings({
          userId: principal.id,
          organizationId,
        }),
        // LEGACY-QUIRK(B): TeamUser fallback rows. Always fetched because
        // the org-scope path unions them on any denial even when bindings
        // exist (rbac.ts:1094-1110); the engine applies the per-scope
        // gating rules.
        this.reader.findLegacyTeamMemberships({
          userId: principal.id,
          organizationId,
        }),
      ]);

    const bindings = [...directBindings, ...groupBindings];
    return {
      principal,
      organizationId,
      organizationRole,
      isOrgMember: organizationRole != null,
      bindings,
      legacyTeamMemberships: legacyRows,
      customRolePermissions: await this.prefetchCustomRolePermissions(
        dedupeCustomRoleIds(bindings, legacyRows),
      ),
    };
  }

  private async prefetchCustomRolePermissions(
    customRoleIds: string[],
  ): Promise<Map<string, readonly string[]>> {
    if (customRoleIds.length === 0) return new Map();
    return parseCustomRolePermissions(
      await this.reader.findCustomRolePermissions({ customRoleIds }),
    );
  }
}

/**
 * Lenient parse, matching both legacy resolvers' net behaviour: malformed
 * or non-array permission JSON degrades to an empty list, which the engine
 * treats as "fall through to the built-in bag", never as a grant.
 */
function parseCustomRolePermissions(
  rows: CustomRolePermissionsRow[],
): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const row of rows) {
    const permissions = Array.isArray(row.permissions)
      ? row.permissions.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    map.set(row.id, permissions);
  }
  return map;
}

function isLiveShareLink(row: ShareLinkRow, now: Date): boolean {
  if (row.expiresAt != null && row.expiresAt <= now) return false;
  if (row.maxViews != null && row.viewCount >= row.maxViews) return false;
  return true;
}

function audienceForVisibility({
  visibility,
  organizationId,
  projectId,
}: {
  visibility: ShareLinkRow["visibility"];
  organizationId: string;
  projectId: string;
}): GrantAudience {
  switch (visibility) {
    case "PUBLIC":
      return { kind: "anyone" };
    case "ORGANIZATION":
      return { kind: "organization", id: organizationId };
    case "PROJECT":
      return { kind: "project", id: projectId };
  }
}

function dedupeCustomRoleIds(
  bindings: ReadonlyArray<{ customRoleId: string | null }>,
  legacyRows: ReadonlyArray<{ customRoleId: string | null }>,
): string[] {
  return Array.from(
    new Set(
      [
        ...bindings.map((binding) => binding.customRoleId),
        ...legacyRows.map((row) => row.customRoleId),
      ].filter((id): id is string => id != null),
    ),
  );
}
