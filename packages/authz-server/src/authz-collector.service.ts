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

export type AuthzCollectorOptions = {
  /** Injected so share-link liveness is testable at its exact boundary. */
  now?: () => Date;
};

export class AuthzCollectorService {
  private readonly now: () => Date;

  constructor(
    private readonly reader: AuthzReadRepository,
    options: AuthzCollectorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

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

  /**
   * The user an API key belongs to, for the ADR-092 §9 owner ceiling.
   * AuthzService asks through here rather than holding its own reader: the
   * collector is the one seam in front of storage.
   */
  async findApiKeyOwner({
    apiKeyId,
  }: {
    apiKeyId: string;
  }): Promise<{ userId: string | null } | null> {
    return this.reader.findApiKeyOwner(apiKeyId);
  }

  async collectGrants({
    principal,
    organizationId,
    reader,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    /**
     * An already-open pass, for a caller collecting SEVERAL snapshots that
     * feed one decision (the api-key ceiling intersects the key's and the
     * owner's): sharing the pass shares its routing decision, so a gate
     * expiry between the collects cannot intersect a legacy binding list
     * with a ledger one. Omitted, the collect opens its own pass.
     */
    reader?: AuthzReadRepository;
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
      // One pass, one head. A collect is several reads and the reader in
      // front of them may route per organization on a cached, TTL-bounded
      // decision; opening a pass fixes that decision for the whole snapshot,
      // so an expiry mid-collect cannot hand the engine half a legacy
      // binding list and half a ledger one (`beginPass` on the port).
      case "apiKey":
        return this.collectApiKeyGrants({
          principal,
          organizationId,
          reader: reader ?? this.beginPass(),
        });
      case "user":
        return this.collectUserGrants({
          principal,
          organizationId,
          reader: reader ?? this.beginPass(),
        });
      default: {
        // A principal kind added to the union without a collect path here
        // would otherwise silently resolve to "no grants" - a fail-open
        // shape. Fail loudly instead.
        const unreachable: never = principal;
        throw new Error(
          `unhandled authz principal type: ${JSON.stringify(unreachable)}`,
        );
      }
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
    // Same one-pass discipline as collectGrants above: the composition
    // root holds ONE reader for the process's lifetime, and a routed
    // reader's head decision is memoized per instance. A gated read taken
    // on that instance directly would pin the organization's head until
    // the pod restarted — defeating the rollback lever. The pass-scoped
    // reader pins for exactly this read and is then dropped.
    const rows = await this.beginPass().findShareLinks({
      projectId: scope.projectId,
      tokens: scope.shareTokens,
      links,
    });
    const now = this.now();
    return rows
      .filter((row) => isLiveShareLink(row, now))
      .map((row) => ({
        kind: kindForResourceType(row.resourceType),
        id: row.resourceId,
        projectId: row.projectId,
        permission: "traces:view",
        // The row's own project anchors both the grant and its audience: a
        // row can only be reached through a query already scoped to this
        // project, and taking the audience from anywhere else would let a
        // grant name a project it does not sit in.
        audience: audienceForVisibility({
          visibility: row.visibility,
          organizationId: scope.organizationId,
          projectId: row.projectId,
        }),
      }));
  }

  /** The reader for ONE snapshot: the routing decision behind it is taken
   *  once and held for every read the snapshot is built from. A reader that
   *  owns a single head offers no `beginPass` and is used directly. Public
   *  so a caller pairing snapshots can hand the same pass to each collect. */
  beginPass(): AuthzReadRepository {
    return this.reader.beginPass?.() ?? this.reader;
  }

  private async collectApiKeyGrants({
    principal,
    organizationId,
    reader,
  }: {
    principal: Extract<AuthzPrincipalRef, { type: "apiKey" }>;
    organizationId: string;
    reader: AuthzReadRepository;
  }): Promise<CollectedGrants> {
    const bindings = await reader.findApiKeyBindings({
      apiKeyId: principal.id,
      organizationId,
    });
    return {
      principal,
      organizationId,
      // A key has no OrganizationUser row and no TeamUser rows of its own:
      // its bindings are the whole story, and the owner's grants enter only
      // as the §9 ceiling, never as an addition.
      organizationRole: null,
      isOrgMember: false,
      bindings,
      legacyTeamMemberships: [],
      customRolePermissions: await this.prefetchCustomRolePermissions({
        principal,
        organizationId,
        customRoleIds: dedupeCustomRoleIds(bindings, []),
        reader,
      }),
    };
  }

  private async collectUserGrants({
    principal,
    organizationId,
    reader,
  }: {
    principal: Extract<AuthzPrincipalRef, { type: "user" }>;
    organizationId: string;
    reader: AuthzReadRepository;
  }): Promise<CollectedGrants> {
    const [organizationRole, directBindings, groupBindings, legacyRows] =
      await Promise.all([
        reader.findOrganizationRole({
          userId: principal.id,
          organizationId,
        }),
        reader.findUserBindings({ userId: principal.id, organizationId }),
        reader.findGroupBindings({
          userId: principal.id,
          organizationId,
        }),
        // LEGACY-QUIRK(B): TeamUser fallback rows. Always fetched because
        // the org-scope path unions them on any denial even when bindings
        // exist (the TeamUser union at the end of legacy
        // hasOrganizationPermissionLegacy); the engine applies the
        // per-scope gating rules.
        reader.findLegacyTeamMemberships({
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
      customRolePermissions: await this.prefetchCustomRolePermissions({
        principal,
        organizationId,
        customRoleIds: dedupeCustomRoleIds(bindings, legacyRows),
        reader,
      }),
    };
  }

  private async prefetchCustomRolePermissions({
    principal,
    organizationId,
    customRoleIds,
    reader,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    customRoleIds: string[];
    reader: AuthzReadRepository;
  }): Promise<Map<string, readonly string[]>> {
    if (customRoleIds.length === 0) return new Map();
    return parseCustomRolePermissions(
      await reader.findCustomRolePermissions({
        organizationId,
        principal,
        customRoleIds,
      }),
    );
  }
}

/**
 * Lenient parse, matching the legacy tRPC resolver's net behaviour:
 * malformed or non-array permission JSON degrades to an empty list, which
 * the engine treats as "fall through to the built-in bag", never as a
 * grant. The legacy API-key resolver is STRICTER here - it rejects a mixed
 * array outright rather than dropping the non-string entries - so on that
 * path this parse is deliberately the more permissive of the two, and the
 * shadow comparison is where that shows up.
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

function kindForResourceType(
  resourceType: ShareLinkRow["resourceType"],
): ShareableResourceKind {
  switch (resourceType) {
    case "TRACE":
      return "trace";
    case "THREAD":
      return "thread";
    default: {
      // A resource type added to the stored enum without a kind here would
      // otherwise need a fallback, and any fallback is a grant matched at a
      // node the resource does not sit at.
      const unreachable: never = resourceType;
      throw new Error(
        `unhandled share link resource type: ${String(unreachable)}`,
      );
    }
  }
}

/**
 * The ADR-057 visibility a link was created with, as the ADR-092 audience
 * it means.
 *
 * KNOWN NARROWING (C5): the PROJECT audience resolves through
 * project-scoped bindings only (see audienceMatches in the engine), while
 * legacy's project-visibility check probes actual project membership - so a
 * caller who reaches the project through a team or organization binding
 * matches legacy and not this. The membership probe lands with the C5
 * storage pass; until then this is narrower than legacy, which fails
 * closed.
 */
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
    default: {
      // A visibility added to the stored enum without an audience here
      // would otherwise fall out as undefined and read as "no audience".
      const unreachable: never = visibility;
      throw new Error(
        `unhandled share link visibility: ${String(unreachable)}`,
      );
    }
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
