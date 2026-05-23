import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";

import type { Session } from "~/server/auth";
import {
  batchScopePermissions,
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "../api/rbac";
import {
  allFeatures,
  featureByKey,
  MODEL_ROLES,
  type ModelRole,
} from "./featureRegistry";
import { resolveModelForFeature } from "./resolveModelForFeature";
import { buildSeedPlanForProvider } from "./seedOnboardingDefaults";

export type ReadCtx = {
  prisma: PrismaClient;
  session: Session | null;
};

type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export type ScopeRef = {
  scopeType: ScopeType;
  scopeId: string;
};

export type DefaultModelEffective = {
  model: string;
  source: string;
  scope: string | null;
};

export type ConfigSnapshotScope = {
  type: ScopeType;
  id: string;
  name: string;
};

export type ConfigSnapshot = {
  id: string;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  authorId: string | null;
  scopes: ConfigSnapshotScope[];
};

export type ScopeAvailable = {
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
};

export type DefaultModelsSnapshot = {
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  effective: Record<ModelRole, DefaultModelEffective | null>;
  configs: ConfigSnapshot[];
  available: ScopeAvailable;
  features: {
    key: string;
    role: ModelRole;
    displayName: string;
    description: string;
  }[];
};

export type InheritedHit = {
  model: string;
  source: "feature_override" | "role_default" | "inferred";
  scope: "project" | "team" | "organization" | null;
  inferredFromProvider?: string;
};

export type InheritedValuesResult = {
  inherited: Record<string, InheritedHit | null>;
  referenceScope: ScopeRef;
};

/**
 * Cascade-resolve a single feature key for a project. Wraps
 * `resolveModelForFeature` for callers that used to read
 * `project.defaultModel` directly. Returns null when nothing is
 * configured at any scope rather than throwing, so the caller can
 * render a placeholder without exception-based control flow.
 */
export async function getResolvedDefaultForFeature(
  ctx: ReadCtx,
  params: { projectId: string; featureKey: string },
): Promise<DefaultModelEffective | null> {
  if (!featureByKey(params.featureKey)) return null;
  try {
    const resolved = await resolveModelForFeature(params.featureKey, {
      prisma: ctx.prisma,
      projectId: params.projectId,
    });
    return {
      model: resolved.model,
      source: resolved.source,
      scope: resolved.scope,
    };
  } catch {
    return null;
  }
}

/**
 * Snapshot for the Default Models settings page (and any API client
 * wanting to render the same view). Shape mirrors RBAC:
 *  - `effective`: three effective default models for this project —
 *    the cascade's "what would I actually use here" answer.
 *  - `configs`: flat list of ModelDefaultConfig rows the caller can
 *    read, each carrying its cascading JSON payload + the scope
 *    attachments the caller has read permission on.
 *  - `available`: scopes the caller can write to (RBAC-filtered) so
 *    the drawer's chip picker is the source of truth without a
 *    redundant authz call.
 */
export async function getDefaultModelsSnapshot(
  ctx: ReadCtx,
  params: { projectId: string },
): Promise<DefaultModelsSnapshot> {
  const { projectId } = params;
  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      team: {
        select: {
          organizationId: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!project) throw new Error("Project not found");

  const teamId = project.teamId;
  const organizationId = project.team?.organizationId ?? null;
  const organizationName = project.team?.organization?.name ?? null;

  const features = allFeatures();

  // Effective resolution per role — uses one feature per role as a
  // proxy since the resolver's role-level walk is shared across all
  // features in the same role.
  const effective: Record<ModelRole, DefaultModelEffective | null> = {
    DEFAULT: null,
    FAST: null,
    EMBEDDINGS: null,
  };
  for (const role of MODEL_ROLES) {
    const proxy = features.find((x) => x.role === role);
    if (!proxy) continue;
    try {
      const r = await resolveModelForFeature(proxy.key, {
        prisma: ctx.prisma,
        projectId,
      });
      effective[role] = { model: r.model, source: r.source, scope: r.scope };
    } catch {
      effective[role] = null;
    }
  }

  // Available (writable) scopes for the drawer's chip picker. Org needs
  // organization:manage, team needs team:manage, project needs
  // project:update — same map the provider update mutation uses.
  let canWriteOrg = false;
  let writableTeams: { id: string; name: string }[] = [];
  let writableProjects: { id: string; name: string; teamId: string }[] = [];
  if (organizationId) {
    canWriteOrg = await hasOrganizationPermission(
      ctx as { prisma: PrismaClient; session: Session },
      organizationId,
      "organization:manage",
    );
    const [orgTeams, orgProjects] = await Promise.all([
      ctx.prisma.team.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      ctx.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true, name: true, teamId: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const projectTeamId: Record<string, string> = {};
    for (const p of orgProjects) projectTeamId[p.id] = p.teamId;
    const teamManageBatch = await batchScopePermissions(ctx, {
      organizationId,
      teamIds: orgTeams.map((t) => t.id),
      projectIds: [],
      projectTeamId: {},
      permission: "team:manage",
    });
    const projectUpdateBatch = await batchScopePermissions(ctx, {
      organizationId,
      teamIds: [],
      projectIds: orgProjects.map((p) => p.id),
      projectTeamId,
      permission: "project:update",
    });
    writableTeams = orgTeams
      .filter((t) => teamManageBatch.teams.get(t.id))
      .map(({ id, name }) => ({ id, name }));
    writableProjects = orgProjects
      .filter((p) => projectUpdateBatch.projects.get(p.id))
      .map(({ id, name, teamId: tid }) => ({ id, name, teamId: tid }));
  } else {
    // Personal-account project (no org/team): only project scope.
    const writable = await hasProjectPermission(
      ctx,
      projectId,
      "project:update",
    );
    if (writable) {
      const refName =
        (
          await ctx.prisma.project.findUnique({
            where: { id: projectId },
            select: { name: true },
          })
        )?.name ?? projectId;
      writableProjects = [
        { id: projectId, name: refName, teamId: teamId ?? "" },
      ];
    }
  }
  const available: ScopeAvailable = {
    organization:
      canWriteOrg && organizationId
        ? { id: organizationId, name: organizationName ?? organizationId }
        : null,
    teams: writableTeams,
    projects: writableProjects,
  };

  // Read-visibility set: scopes the caller can actually *read*, not the
  // union of every scope in the organization. A project-only viewer must
  // not receive policy rows attached to sibling scopes they have no read
  // permission on — that would leak the org-wide policy landscape.
  const canReadOrg =
    !!organizationId &&
    (await hasOrganizationPermission(
      ctx as { prisma: PrismaClient; session: Session },
      organizationId,
      "organization:view",
    ));
  let readableTeamIds: string[] = [];
  let readableProjectIds: string[] = [projectId];
  if (organizationId) {
    const [orgTeams, orgProjects] = await Promise.all([
      ctx.prisma.team.findMany({
        where: { organizationId },
        select: { id: true },
      }),
      ctx.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true, teamId: true },
      }),
    ]);
    const projectTeamId: Record<string, string> = {};
    for (const p of orgProjects) projectTeamId[p.id] = p.teamId;
    const [teamReadBatch, projectReadBatch] = await Promise.all([
      batchScopePermissions(ctx, {
        organizationId,
        teamIds: orgTeams.map((t) => t.id),
        projectIds: [],
        projectTeamId: {},
        permission: "team:view",
      }),
      batchScopePermissions(ctx, {
        organizationId,
        teamIds: [],
        projectIds: orgProjects.map((p) => p.id),
        projectTeamId,
        permission: "project:view",
      }),
    ]);
    readableTeamIds = orgTeams
      .filter((t) => teamReadBatch.teams.get(t.id))
      .map((t) => t.id);
    readableProjectIds = orgProjects
      .filter((p) => projectReadBatch.projects.get(p.id))
      .map((p) => p.id);
  } else if (teamId) {
    const teamReadable = await hasTeamPermission(ctx, teamId, "team:view");
    if (teamReadable) readableTeamIds = [teamId];
  }

  const visibleScopeFilter = [
    canReadOrg && organizationId
      ? { scopeType: "ORGANIZATION" as const, scopeId: organizationId }
      : null,
    readableTeamIds.length > 0
      ? { scopeType: "TEAM" as const, scopeId: { in: readableTeamIds } }
      : null,
    readableProjectIds.length > 0
      ? { scopeType: "PROJECT" as const, scopeId: { in: readableProjectIds } }
      : null,
  ].filter(Boolean) as Array<{
    scopeType: ScopeType;
    scopeId: string | { in: string[] };
  }>;

  const configRows =
    visibleScopeFilter.length > 0
      ? await ctx.prisma.modelDefaultConfig.findMany({
          where: { scopes: { some: { OR: visibleScopeFilter } } },
          select: {
            id: true,
            config: true,
            createdAt: true,
            updatedAt: true,
            authorId: true,
            scopes: {
              select: { id: true, scopeType: true, scopeId: true },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  // Resolve scope names so the UI can render chips without an extra
  // round trip. Pull only the ids we actually saw.
  const seenTeamIds = Array.from(
    new Set(
      configRows.flatMap((c) =>
        c.scopes.filter((s) => s.scopeType === "TEAM").map((s) => s.scopeId),
      ),
    ),
  );
  const seenProjectIds = Array.from(
    new Set(
      configRows.flatMap((c) =>
        c.scopes
          .filter((s) => s.scopeType === "PROJECT")
          .map((s) => s.scopeId),
      ),
    ),
  );
  const [seenTeams, seenProjects] = await Promise.all([
    seenTeamIds.length > 0
      ? ctx.prisma.team.findMany({
          where: { id: { in: seenTeamIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    seenProjectIds.length > 0
      ? ctx.prisma.project.findMany({
          where: { id: { in: seenProjectIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const teamNameById = new Map(seenTeams.map((t) => [t.id, t.name]));
  const projectNameById = new Map(seenProjects.map((p) => [p.id, p.name]));
  const scopeName = (scopeType: ScopeType, scopeId: string): string => {
    if (scopeType === "ORGANIZATION") return organizationName ?? scopeId;
    if (scopeType === "TEAM") return teamNameById.get(scopeId) ?? scopeId;
    return projectNameById.get(scopeId) ?? scopeId;
  };

  // Sort scopes within each config (Organization → Teams → Projects,
  // each alphabetical) so chip render order is stable across reloads.
  const scopeRank = { ORGANIZATION: 0, TEAM: 1, PROJECT: 2 } as const;
  // The Prisma query above matches configs that have AT LEAST one
  // readable scope, but the returned `scopes` array carries every
  // attachment on each matched config — including ones in other
  // readable teams / projects the caller has no access to. Mirror the
  // input filter when projecting the response.
  const readableTeamIdSet = new Set(readableTeamIds);
  const readableProjectIdSet = new Set(readableProjectIds);
  const isReadableScope = (scopeType: ScopeType, scopeId: string): boolean => {
    if (scopeType === "ORGANIZATION") {
      return canReadOrg && scopeId === organizationId;
    }
    if (scopeType === "TEAM") return readableTeamIdSet.has(scopeId);
    return readableProjectIdSet.has(scopeId);
  };
  const configs: ConfigSnapshot[] = configRows.map((c) => ({
    id: c.id,
    config: c.config as Record<string, string>,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    authorId: c.authorId,
    scopes: c.scopes
      .filter((s) => isReadableScope(s.scopeType, s.scopeId))
      .map((s) => ({
        type: s.scopeType,
        id: s.scopeId,
        name: scopeName(s.scopeType, s.scopeId),
      }))
      .sort((x, y) => {
        if (x.type !== y.type) return scopeRank[x.type] - scopeRank[y.type];
        return x.name.localeCompare(y.name);
      }),
  }));

  const featureProjection = features.map((f) => ({
    key: f.key,
    role: f.role,
    displayName: f.displayName,
    description: f.description,
  }));

  return {
    projectId,
    teamId,
    organizationId,
    organizationName,
    effective,
    configs,
    available,
    features: featureProjection,
  };
}

/**
 * "What would the cascade hand back for these scopes if I had no value
 * here?" — drives the drawer's inherited-as-placeholder and the
 * "Inherit (from organization) [openai/gpt-5.5]" dropdown entry.
 *
 * The walk is computed for the most-specific picked scope (project beats
 * team beats org), excluding any config attached to the picked scopes
 * themselves and an optional `excludeConfigId` so the in-progress draft
 * is treated as "not yet saved". For each role + each registered feature
 * key, the response carries the model the cascade would resolve to and
 * the scope tier it came from.
 *
 * When the cascade has nothing AND there's a provider visible to the
 * caller that could fulfill a role, the response surfaces an `inferred`
 * suggestion from the registry's latest-flagship heuristic — same logic
 * the onboarding seed uses.
 */
export async function getInheritedValuesForScopes(
  ctx: ReadCtx,
  params: {
    projectId: string;
    scopes: ScopeRef[];
    excludeConfigId?: string;
  },
): Promise<InheritedValuesResult> {
  const project = await ctx.prisma.project.findUnique({
    where: { id: params.projectId },
    select: {
      id: true,
      teamId: true,
      team: { select: { organizationId: true } },
    },
  });
  if (!project) throw new Error("Project not found");
  const teamId = project.teamId;
  const organizationId = project.team?.organizationId ?? null;

  // Cross-tenant guard: a hostile caller could pass a scopeId from
  // another org; validate every picked id resolves to the SAME org as
  // `params.projectId` before going further.
  if (!organizationId) {
    throw new Error("Project has no organization; cannot resolve scopes.");
  }
  const pickedTeamIds = params.scopes
    .filter((s) => s.scopeType === "TEAM")
    .map((s) => s.scopeId);
  const pickedProjectIds = params.scopes
    .filter((s) => s.scopeType === "PROJECT")
    .map((s) => s.scopeId);
  const pickedOrgIds = params.scopes
    .filter((s) => s.scopeType === "ORGANIZATION")
    .map((s) => s.scopeId);
  if (pickedOrgIds.some((id) => id !== organizationId)) {
    throw new Error(
      "Scope organization does not match project organization.",
    );
  }
  if (pickedTeamIds.length > 0) {
    const sameOrgTeams = await ctx.prisma.team.findMany({
      where: { id: { in: pickedTeamIds }, organizationId },
      select: { id: true },
    });
    if (sameOrgTeams.length !== new Set(pickedTeamIds).size) {
      throw new Error("Scope team does not belong to project organization.");
    }
  }
  if (pickedProjectIds.length > 0) {
    const sameOrgProjects = await ctx.prisma.project.findMany({
      where: { id: { in: pickedProjectIds }, team: { organizationId } },
      select: { id: true },
    });
    if (sameOrgProjects.length !== new Set(pickedProjectIds).size) {
      throw new Error(
        "Scope project does not belong to project organization.",
      );
    }
  }

  // The cascade we want to surface is "what would a project see inside
  // the most-specific picked scope". Pick the most-specific tier
  // (PROJECT beats TEAM beats ORGANIZATION).
  const tierRank = { PROJECT: 0, TEAM: 1, ORGANIZATION: 2 } as const;
  const sortedPicked = [...params.scopes].sort(
    (a, b) => tierRank[a.scopeType] - tierRank[b.scopeType],
  );
  const referenceScope = sortedPicked[0]!;

  // Resolve the chain that "anchors" the cascade walk.
  let chainTeamId: string | null = null;
  let chainOrganizationId: string | null = null;
  if (referenceScope.scopeType === "PROJECT") {
    const refProject = await ctx.prisma.project.findUnique({
      where: { id: referenceScope.scopeId },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    chainTeamId = refProject?.teamId ?? null;
    chainOrganizationId = refProject?.team?.organizationId ?? null;
  } else if (referenceScope.scopeType === "TEAM") {
    const refTeam = await ctx.prisma.team.findUnique({
      where: { id: referenceScope.scopeId },
      select: { organizationId: true },
    });
    chainTeamId = referenceScope.scopeId;
    chainOrganizationId = refTeam?.organizationId ?? null;
  } else {
    chainOrganizationId = referenceScope.scopeId;
  }

  const excludedScopes = new Set(
    params.scopes.map((s) => `${s.scopeType}::${s.scopeId}`),
  );

  const tiers: Array<{
    tier: "project" | "team" | "organization";
    scopeType: ModelDefaultScopeType;
    scopeId: string;
  }> = [];
  if (
    referenceScope.scopeType === "PROJECT" &&
    !excludedScopes.has(`PROJECT::${referenceScope.scopeId}`)
  ) {
    tiers.push({
      tier: "project",
      scopeType: "PROJECT",
      scopeId: referenceScope.scopeId,
    });
  }
  if (chainTeamId && !excludedScopes.has(`TEAM::${chainTeamId}`)) {
    tiers.push({ tier: "team", scopeType: "TEAM", scopeId: chainTeamId });
  }
  if (
    chainOrganizationId &&
    !excludedScopes.has(`ORGANIZATION::${chainOrganizationId}`)
  ) {
    tiers.push({
      tier: "organization",
      scopeType: "ORGANIZATION",
      scopeId: chainOrganizationId,
    });
  }

  const tierScopeIds = tiers.map((t) => ({
    scopeType: t.scopeType,
    scopeId: t.scopeId,
  }));
  const candidateConfigs =
    tierScopeIds.length > 0
      ? await ctx.prisma.modelDefaultConfig.findMany({
          where: {
            AND: [
              params.excludeConfigId
                ? { id: { not: params.excludeConfigId } }
                : {},
              { scopes: { some: { OR: tierScopeIds } } },
            ],
          },
          select: {
            id: true,
            config: true,
            createdAt: true,
            scopes: { select: { scopeType: true, scopeId: true } },
          },
        })
      : [];

  const readKey = (cfg: unknown, key: string): string | null => {
    if (typeof cfg !== "object" || cfg === null) return null;
    const v = (cfg as Record<string, unknown>)[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  type Hit = {
    model: string;
    source: "feature_override" | "role_default";
    scope: "project" | "team" | "organization";
  };
  const walkKey = (key: string, isFeatureKey: boolean): Hit | null => {
    for (const t of tiers) {
      const attached = candidateConfigs
        .filter((c) =>
          c.scopes.some(
            (s) => s.scopeType === t.scopeType && s.scopeId === t.scopeId,
          ),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      for (const c of attached) {
        const value = readKey(c.config, key);
        if (value) {
          return {
            model: value,
            source: isFeatureKey ? "feature_override" : "role_default",
            scope: t.tier,
          };
        }
      }
    }
    return null;
  };

  // Inference fallback: when cascade returns nothing for a role and
  // there's an enabled provider visible at any scope, suggest the
  // registry's latest-flagship for that role — same heuristic the
  // onboarding seed uses.
  const providers = organizationId
    ? await ctx.prisma.modelProvider.findMany({
        where: {
          enabled: true,
          scopes: {
            some: {
              OR: [
                { scopeType: "ORGANIZATION", scopeId: organizationId },
                teamId
                  ? { scopeType: "TEAM", scopeId: teamId }
                  : { scopeType: "TEAM", scopeId: "__none__" },
                { scopeType: "PROJECT", scopeId: params.projectId },
              ],
            },
          },
        },
        select: { provider: true, scopes: { select: { scopeType: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const inferenceProvider = providers[0]?.provider;
  const inferencePlan = inferenceProvider
    ? buildSeedPlanForProvider(inferenceProvider)
    : {};

  const features = allFeatures();
  const inherited: Record<string, InheritedHit | null> = {};

  for (const role of MODEL_ROLES) {
    const hit = walkKey(role, false);
    if (hit) {
      inherited[role] = hit;
      continue;
    }
    const inferredModel = (
      inferencePlan as Record<string, string | undefined>
    )[role];
    if (inferredModel && inferenceProvider) {
      inherited[role] = {
        model: inferredModel,
        source: "inferred",
        scope: null,
        inferredFromProvider: inferenceProvider,
      };
      continue;
    }
    inherited[role] = null;
  }

  for (const f of features) {
    const featureHit = walkKey(f.key, true);
    if (featureHit) {
      inherited[f.key] = featureHit;
      continue;
    }
    const roleHit = inherited[f.role];
    if (roleHit) {
      inherited[f.key] = roleHit;
      continue;
    }
    inherited[f.key] = null;
  }

  return {
    inherited,
    referenceScope: {
      scopeType: referenceScope.scopeType,
      scopeId: referenceScope.scopeId,
    },
  };
}
