/**
 * ADR-092 §2 — COLLECT: the only place authorization data is read from
 * Postgres. One snapshot per (principal, organization) feeds any number of
 * pure decide() calls, and is what the stage-F epoch cache stores.
 */
import type {
  AuthzPrincipalRef,
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  GrantAudience,
  LegacyTeamMembership,
  ResourceGrant,
  ShareableResourceKind,
} from "@langwatch/authz";
import type { PrismaClient, ShareVisibility } from "@prisma/client";

/**
 * Resolve a scope reference from the ids a request carries. Project ids are
 * resolved to their owning team + organization (the tenant comes from the
 * resource, never from the caller — same posture as the legacy project path).
 * Returns null when the id does not exist.
 */
export async function resolveScopeRef({
  prisma,
  projectId,
  teamId,
  organizationId,
}: {
  prisma: PrismaClient;
  projectId?: string;
  teamId?: string;
  organizationId?: string;
}): Promise<AuthzScopeRef | null> {
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true, organizationId: true } } },
    });
    if (!project?.team) return null;
    return {
      type: "project",
      id: projectId,
      teamId: project.team.id,
      organizationId: project.team.organizationId,
    };
  }
  if (teamId) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
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
 * What this function verifies: the project's team/organization lineage is
 * read from Postgres here, never taken from the request - same posture as
 * resolveScopeRef. What it CANNOT verify: that `id` lives in `projectId`,
 * and that `parentThreadId` is the trace's own thread - traces live in
 * ClickHouse. Both anchors MUST come off the stored row the caller already
 * fetched (that read is scoped by projectId, which is what enforces them).
 * Passing request input for either reopens the forged-parent hole: one
 * shared thread would unlock unrelated traces through the parent link.
 * Returns null when the project does not exist.
 */
export async function resolveResourceScopeRef({
  prisma,
  projectId,
  kind,
  id,
  parentThreadId,
  shareTokens,
}: {
  prisma: PrismaClient;
  projectId: string;
  kind: ShareableResourceKind;
  id: string;
  parentThreadId?: string;
  shareTokens?: readonly string[];
}): Promise<AuthzScopeRef | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { id: true, organizationId: true } } },
  });
  if (!project?.team) return null;
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
    teamId: project.team.id,
    organizationId: project.team.organizationId,
  };
}

async function prefetchCustomRolePermissions({
  prisma,
  customRoleIds,
}: {
  prisma: PrismaClient;
  customRoleIds: string[];
}): Promise<Map<string, readonly string[]>> {
  const map = new Map<string, readonly string[]>();
  if (customRoleIds.length === 0) return map;
  const rows = await prisma.customRole.findMany({
    where: { id: { in: customRoleIds } },
    select: { id: true, permissions: true },
  });
  for (const row of rows) {
    // Lenient parse, matching both legacy resolvers' net behaviour: malformed
    // or non-array permission JSON degrades to an empty list, which the
    // engine treats as "fall through to the built-in bag", never as a grant.
    const permissions = Array.isArray(row.permissions)
      ? row.permissions.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    map.set(row.id, permissions);
  }
  return map;
}

export async function collectGrants({
  prisma,
  principal,
  organizationId,
}: {
  prisma: PrismaClient;
  principal: AuthzPrincipalRef;
  organizationId: string;
}): Promise<CollectedGrants> {
  switch (principal.type) {
    case "anonymous":
      // No session, no queries: an anonymous caller holds nothing except
      // what resource grants with the `anyone` audience (and the demo
      // project) give at decide time.
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
      return collectApiKeyGrants({ prisma, principal, organizationId });
    case "user":
      return collectUserGrants({ prisma, principal, organizationId });
  }
}

async function collectApiKeyGrants({
  prisma,
  principal,
  organizationId,
}: {
  prisma: PrismaClient;
  principal: Extract<AuthzPrincipalRef, { type: "apiKey" }>;
  organizationId: string;
}): Promise<CollectedGrants> {
  const keyBindings = await prisma.roleBinding.findMany({
    where: { organizationId, apiKeyId: principal.id },
    select: {
      role: true,
      customRoleId: true,
      scopeType: true,
      scopeId: true,
    },
  });
  const bindings: CollectedBinding[] = keyBindings.map((row) => ({
    ...row,
    viaGroupId: null,
  }));
  return {
    principal,
    organizationId,
    organizationRole: null,
    isOrgMember: false,
    bindings,
    legacyTeamMemberships: [],
    customRolePermissions: await prefetchCustomRolePermissions({
      prisma,
      customRoleIds: dedupeCustomRoleIds(bindings, []),
    }),
  };
}

async function collectUserGrants({
  prisma,
  principal,
  organizationId,
}: {
  prisma: PrismaClient;
  principal: Extract<AuthzPrincipalRef, { type: "user" }>;
  organizationId: string;
}): Promise<CollectedGrants> {
  const [orgMember, directBindings, groupBindings] = await Promise.all([
    prisma.organizationUser.findFirst({
      where: { userId: principal.id, organizationId },
      select: { role: true },
    }),
    prisma.roleBinding.findMany({
      where: { organizationId, userId: principal.id },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    }),
    prisma.roleBinding.findMany({
      where: {
        organizationId,
        group: { members: { some: { userId: principal.id } } },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
        groupId: true,
      },
    }),
  ]);

  const bindings: CollectedBinding[] = [
    ...directBindings.map((row) => ({ ...row, viaGroupId: null })),
    ...groupBindings.map(({ groupId, ...row }) => ({
      ...row,
      viaGroupId: groupId,
    })),
  ];

  // LEGACY-QUIRK(B): TeamUser fallback rows. Always fetched because the
  // org-scope path unions them on any denial even when bindings exist
  // (rbac.ts:1094-1110); the engine applies the per-scope gating rules.
  // One indexed query, deleted in stage B.
  const teamRows = await prisma.teamUser.findMany({
    where: { userId: principal.id, team: { organizationId } },
    select: {
      teamId: true,
      role: true,
      assignedRoleId: true,
      team: { select: { isPersonal: true } },
    },
  });
  const legacyTeamMemberships: LegacyTeamMembership[] = teamRows.map((row) => ({
    teamId: row.teamId,
    role: row.role,
    customRoleId: row.assignedRoleId ?? null,
    isPersonal: row.team.isPersonal,
  }));

  return {
    principal,
    organizationId,
    organizationRole: orgMember?.role ?? null,
    isOrgMember: orgMember != null,
    bindings,
    legacyTeamMemberships,
    customRolePermissions: await prefetchCustomRolePermissions({
      prisma,
      customRoleIds: dedupeCustomRoleIds(bindings, legacyTeamMemberships),
    }),
  };
}

/**
 * ADR-092 §8 / stage A5 — resource-tier grants for a resource scope's links
 * (the resource itself plus shareable ancestors).
 *
 * SHIM: storage is the ADR-057 `ShareLink` table, read as grants of
 * `traces:view` with the audience its visibility implies. Two ADR-057
 * invariants are preserved here: possession of the token — not row
 * existence — is what activates a grant (no presented tokens, no reads, no
 * grants), and liveness (expiry, view budget) is filtered before the engine
 * ever sees a row. View CONSUMPTION stays in ShareService: this reader is
 * pure. The C5 migration extends ShareLink into full ResourceGrant storage
 * (per-row permission, principal audiences) rather than adding a parallel
 * table.
 */
export async function collectResourceGrants({
  prisma,
  scope,
}: {
  prisma: PrismaClient;
  scope: AuthzScopeRef;
}): Promise<ResourceGrant[]> {
  if (scope.type !== "resource") return [];
  if (!scope.shareTokens || scope.shareTokens.length === 0) return [];
  const links = [{ kind: scope.kind, id: scope.id }, ...(scope.parents ?? [])];
  const rows = await prisma.shareLink.findMany({
    where: {
      projectId: scope.projectId,
      token: { in: [...scope.shareTokens] },
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
  const now = new Date();
  return rows
    .filter((row) => row.expiresAt == null || row.expiresAt > now)
    .filter((row) => row.maxViews == null || row.viewCount < row.maxViews)
    .map((row) => ({
      kind:
        row.resourceType === "TRACE" ? ("trace" as const) : ("thread" as const),
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

function audienceForVisibility({
  visibility,
  organizationId,
  projectId,
}: {
  visibility: ShareVisibility;
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
  bindings: CollectedBinding[],
  legacyRows: LegacyTeamMembership[],
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
