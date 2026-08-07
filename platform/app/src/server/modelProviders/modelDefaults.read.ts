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
 * Effective resolution per role — uses one feature per role as a
 * proxy since the resolver's role-level walk is shared across all
 * features in the same role.
 */
async function resolveEffectiveDefaults({
  ctx,
  projectId,
  features,
}: {
  ctx: ReadCtx;
  projectId: string;
  features: ReturnType<typeof allFeatures>;
}): Promise<Record<ModelRole, DefaultModelEffective | null>> {
  const effective: Record<ModelRole, DefaultModelEffective | null> = {
    DEFAULT: null,
    FAST: null,
    LANGY: null,
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
  return effective;
}

async function loadOrgWritableScopes({
  ctx,
  organizationId,
}: {
  ctx: ReadCtx;
  organizationId: string;
}): Promise<{
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
}> {
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
  return {
    teams: orgTeams
      .filter((t) => teamManageBatch.teams.get(t.id))
      .map(({ id, name }) => ({ id, name })),
    projects: orgProjects
      .filter((p) => projectUpdateBatch.projects.get(p.id))
      .map(({ id, name, teamId: tid }) => ({ id, name, teamId: tid })),
  };
}

/** Personal-account project (no org/team): only project scope. */
async function loadPersonalWritableProjects({
  ctx,
  projectId,
  teamId,
}: {
  ctx: ReadCtx;
  projectId: string;
  teamId: string | null;
}): Promise<{ id: string; name: string; teamId: string }[]> {
  const writable = await hasProjectPermission(ctx, projectId, "project:update");
  if (!writable) return [];
  const refName =
    (
      await ctx.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      })
    )?.name ?? projectId;
  return [{ id: projectId, name: refName, teamId: teamId ?? "" }];
}

/**
 * Available (writable) scopes for the drawer's chip picker. Org needs
 * organization:manage, team needs team:manage, project needs
 * project:update — same map the provider update mutation uses.
 */
async function loadAvailableScopes({
  ctx,
  projectId,
  teamId,
  organizationId,
  organizationName,
}: {
  ctx: ReadCtx;
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
  organizationName: string | null;
}): Promise<ScopeAvailable> {
  if (!organizationId) {
    return {
      organization: null,
      teams: [],
      projects: await loadPersonalWritableProjects({ ctx, projectId, teamId }),
    };
  }

  const canWriteOrg = await hasOrganizationPermission(
    ctx as { prisma: PrismaClient; session: Session },
    organizationId,
    "organization:manage",
  );
  const { teams, projects } = await loadOrgWritableScopes({
    ctx,
    organizationId,
  });
  return {
    organization: canWriteOrg
      ? { id: organizationId, name: organizationName ?? organizationId }
      : null,
    teams,
    projects,
  };
}

async function loadOrgReadableIds({
  ctx,
  organizationId,
}: {
  ctx: ReadCtx;
  organizationId: string;
}): Promise<{ teamIds: string[]; projectIds: string[] }> {
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
  return {
    teamIds: orgTeams
      .filter((t) => teamReadBatch.teams.get(t.id))
      .map((t) => t.id),
    projectIds: orgProjects
      .filter((p) => projectReadBatch.projects.get(p.id))
      .map((p) => p.id),
  };
}

/**
 * Read-visibility set: scopes the caller can actually *read*, not the
 * union of every scope in the organization. A project-only viewer must
 * not receive policy rows attached to sibling scopes they have no read
 * permission on — that would leak the org-wide policy landscape.
 */
async function loadReadableScopes({
  ctx,
  projectId,
  teamId,
  organizationId,
}: {
  ctx: ReadCtx;
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
}): Promise<{
  canReadOrg: boolean;
  readableTeamIds: string[];
  readableProjectIds: string[];
}> {
  const canReadOrg =
    !!organizationId &&
    (await hasOrganizationPermission(
      ctx as { prisma: PrismaClient; session: Session },
      organizationId,
      "organization:view",
    ));

  if (organizationId) {
    const { teamIds, projectIds } = await loadOrgReadableIds({
      ctx,
      organizationId,
    });
    return {
      canReadOrg,
      readableTeamIds: teamIds,
      readableProjectIds: projectIds,
    };
  }
  if (teamId) {
    const teamReadable = await hasTeamPermission(ctx, teamId, "team:view");
    return {
      canReadOrg,
      readableTeamIds: teamReadable ? [teamId] : [],
      readableProjectIds: [projectId],
    };
  }
  return { canReadOrg, readableTeamIds: [], readableProjectIds: [projectId] };
}

type VisibleConfigRow = {
  id: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
  authorId: string | null;
  scopes: { id: string; scopeType: ScopeType; scopeId: string }[];
};

async function loadVisibleConfigRows({
  ctx,
  canReadOrg,
  organizationId,
  readableTeamIds,
  readableProjectIds,
}: {
  ctx: ReadCtx;
  canReadOrg: boolean;
  organizationId: string | null;
  readableTeamIds: string[];
  readableProjectIds: string[];
}): Promise<VisibleConfigRow[]> {
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

  if (visibleScopeFilter.length === 0) return [];

  return await ctx.prisma.modelDefaultConfig.findMany({
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
  });
}

type VisibleConfigRows = VisibleConfigRow[];

/**
 * Resolve scope names so the UI can render chips without an extra
 * round trip. Pull only the ids we actually saw.
 */
async function loadScopeNames({
  ctx,
  configRows,
}: {
  ctx: ReadCtx;
  configRows: VisibleConfigRows;
}): Promise<{
  teamNameById: Map<string, string>;
  projectNameById: Map<string, string>;
}> {
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
        c.scopes.filter((s) => s.scopeType === "PROJECT").map((s) => s.scopeId),
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
  return {
    teamNameById: new Map(seenTeams.map((t) => [t.id, t.name])),
    projectNameById: new Map(seenProjects.map((p) => [p.id, p.name])),
  };
}

const scopeDisplayName = ({
  scopeType,
  scopeId,
  organizationName,
  teamNameById,
  projectNameById,
}: {
  scopeType: ScopeType;
  scopeId: string;
  organizationName: string | null;
  teamNameById: Map<string, string>;
  projectNameById: Map<string, string>;
}): string => {
  if (scopeType === "ORGANIZATION") return organizationName ?? scopeId;
  if (scopeType === "TEAM") return teamNameById.get(scopeId) ?? scopeId;
  return projectNameById.get(scopeId) ?? scopeId;
};

/**
 * The Prisma query behind `loadVisibleConfigRows` matches configs that
 * have AT LEAST one readable scope, but the returned `scopes` array
 * carries every attachment on each matched config — including ones in
 * other readable teams / projects the caller has no access to. Mirror
 * the input filter when projecting the response.
 */
const isReadableScope = ({
  scopeType,
  scopeId,
  canReadOrg,
  organizationId,
  readableTeamIdSet,
  readableProjectIdSet,
}: {
  scopeType: ScopeType;
  scopeId: string;
  canReadOrg: boolean;
  organizationId: string | null;
  readableTeamIdSet: Set<string>;
  readableProjectIdSet: Set<string>;
}): boolean => {
  if (scopeType === "ORGANIZATION") {
    return canReadOrg && scopeId === organizationId;
  }
  if (scopeType === "TEAM") return readableTeamIdSet.has(scopeId);
  return readableProjectIdSet.has(scopeId);
};

// Sort scopes within each config (Organization → Teams → Projects,
// each alphabetical) so chip render order is stable across reloads.
const SCOPE_RANK = { ORGANIZATION: 0, TEAM: 1, PROJECT: 2 } as const;

const byScopeRankThenName = (
  x: ConfigSnapshotScope,
  y: ConfigSnapshotScope,
): number => {
  if (x.type !== y.type) return SCOPE_RANK[x.type] - SCOPE_RANK[y.type];
  return x.name.localeCompare(y.name);
};

async function projectConfigSnapshots({
  ctx,
  configRows,
  organizationId,
  organizationName,
  canReadOrg,
  readableTeamIds,
  readableProjectIds,
}: {
  ctx: ReadCtx;
  configRows: VisibleConfigRows;
  organizationId: string | null;
  organizationName: string | null;
  canReadOrg: boolean;
  readableTeamIds: string[];
  readableProjectIds: string[];
}): Promise<ConfigSnapshot[]> {
  const { teamNameById, projectNameById } = await loadScopeNames({
    ctx,
    configRows,
  });
  const readableTeamIdSet = new Set(readableTeamIds);
  const readableProjectIdSet = new Set(readableProjectIds);

  return configRows.map((c) => ({
    id: c.id,
    config: c.config as Record<string, string>,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    authorId: c.authorId,
    scopes: c.scopes
      .filter((s) =>
        isReadableScope({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
          canReadOrg,
          organizationId,
          readableTeamIdSet,
          readableProjectIdSet,
        }),
      )
      .map((s) => ({
        type: s.scopeType,
        id: s.scopeId,
        name: scopeDisplayName({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
          organizationName,
          teamNameById,
          projectNameById,
        }),
      }))
      .sort(byScopeRankThenName),
  }));
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

  const effective = await resolveEffectiveDefaults({
    ctx,
    projectId,
    features,
  });

  const available = await loadAvailableScopes({
    ctx,
    projectId,
    teamId,
    organizationId,
    organizationName,
  });

  const { canReadOrg, readableTeamIds, readableProjectIds } =
    await loadReadableScopes({ ctx, projectId, teamId, organizationId });

  const configRows = await loadVisibleConfigRows({
    ctx,
    canReadOrg,
    organizationId,
    readableTeamIds,
    readableProjectIds,
  });

  const configs = await projectConfigSnapshots({
    ctx,
    configRows,
    organizationId,
    organizationName,
    canReadOrg,
    readableTeamIds,
    readableProjectIds,
  });

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
 * Cross-tenant guard: a hostile caller could pass a scopeId from
 * another org; validate every picked id resolves to the SAME org as
 * `params.projectId` before going further.
 */
async function assertScopesInOrganization({
  ctx,
  scopes,
  organizationId,
}: {
  ctx: ReadCtx;
  scopes: ScopeRef[];
  organizationId: string;
}): Promise<void> {
  const pickedTeamIds = scopes
    .filter((s) => s.scopeType === "TEAM")
    .map((s) => s.scopeId);
  const pickedProjectIds = scopes
    .filter((s) => s.scopeType === "PROJECT")
    .map((s) => s.scopeId);
  const pickedOrgIds = scopes
    .filter((s) => s.scopeType === "ORGANIZATION")
    .map((s) => s.scopeId);
  if (pickedOrgIds.some((id) => id !== organizationId)) {
    throw new Error("Scope organization does not match project organization.");
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
      throw new Error("Scope project does not belong to project organization.");
    }
  }
}

/**
 * The cascade we want to surface is "what would a project see inside
 * the most-specific picked scope". Pick the most-specific tier
 * (PROJECT beats TEAM beats ORGANIZATION).
 */
const TIER_RANK = { PROJECT: 0, TEAM: 1, ORGANIZATION: 2 } as const;

function mostSpecificScope(scopes: ScopeRef[]): ScopeRef {
  const sortedPicked = [...scopes].sort(
    (a, b) => TIER_RANK[a.scopeType] - TIER_RANK[b.scopeType],
  );
  return sortedPicked[0]!;
}

/** Resolve the chain that "anchors" the cascade walk. */
async function loadAnchorChain({
  ctx,
  referenceScope,
}: {
  ctx: ReadCtx;
  referenceScope: ScopeRef;
}): Promise<{
  chainTeamId: string | null;
  chainOrganizationId: string | null;
}> {
  if (referenceScope.scopeType === "PROJECT") {
    const refProject = await ctx.prisma.project.findUnique({
      where: { id: referenceScope.scopeId },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    return {
      chainTeamId: refProject?.teamId ?? null,
      chainOrganizationId: refProject?.team?.organizationId ?? null,
    };
  }
  if (referenceScope.scopeType === "TEAM") {
    const refTeam = await ctx.prisma.team.findUnique({
      where: { id: referenceScope.scopeId },
      select: { organizationId: true },
    });
    return {
      chainTeamId: referenceScope.scopeId,
      chainOrganizationId: refTeam?.organizationId ?? null,
    };
  }
  return { chainTeamId: null, chainOrganizationId: referenceScope.scopeId };
}

type CascadeTier = {
  tier: "project" | "team" | "organization";
  scopeType: ModelDefaultScopeType;
  scopeId: string;
};

function buildCascadeTiers({
  scopes,
  referenceScope,
  chainTeamId,
  chainOrganizationId,
}: {
  scopes: ScopeRef[];
  referenceScope: ScopeRef;
  chainTeamId: string | null;
  chainOrganizationId: string | null;
}): CascadeTier[] {
  const excludedScopes = new Set(
    scopes.map((s) => `${s.scopeType}::${s.scopeId}`),
  );

  const tiers: CascadeTier[] = [];
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
  return tiers;
}

type CandidateConfig = {
  id: string;
  config: unknown;
  createdAt: Date;
  scopes: { scopeType: ModelDefaultScopeType; scopeId: string }[];
};

async function loadCandidateConfigs({
  ctx,
  tiers,
  excludeConfigId,
}: {
  ctx: ReadCtx;
  tiers: CascadeTier[];
  excludeConfigId?: string;
}): Promise<CandidateConfig[]> {
  const tierScopeIds = tiers.map((t) => ({
    scopeType: t.scopeType,
    scopeId: t.scopeId,
  }));
  if (tierScopeIds.length === 0) return [];

  return await ctx.prisma.modelDefaultConfig.findMany({
    where: {
      AND: [
        excludeConfigId ? { id: { not: excludeConfigId } } : {},
        { scopes: { some: { OR: tierScopeIds } } },
      ],
    },
    select: {
      id: true,
      config: true,
      createdAt: true,
      scopes: { select: { scopeType: true, scopeId: true } },
    },
  });
}

type CandidateConfigs = CandidateConfig[];

const readConfigKey = (cfg: unknown, key: string): string | null => {
  if (typeof cfg !== "object" || cfg === null) return null;
  const v = (cfg as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
};

type CascadeHit = {
  model: string;
  source: "feature_override" | "role_default";
  scope: "project" | "team" | "organization";
};

const configsAttachedToTier = (
  candidateConfigs: CandidateConfigs,
  tier: CascadeTier,
): CandidateConfigs =>
  candidateConfigs
    .filter((c) =>
      c.scopes.some(
        (s) => s.scopeType === tier.scopeType && s.scopeId === tier.scopeId,
      ),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

function walkTiersForKey({
  tiers,
  candidateConfigs,
  key,
  isFeatureKey,
}: {
  tiers: CascadeTier[];
  candidateConfigs: CandidateConfigs;
  key: string;
  isFeatureKey: boolean;
}): CascadeHit | null {
  for (const t of tiers) {
    for (const c of configsAttachedToTier(candidateConfigs, t)) {
      const value = readConfigKey(c.config, key);
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
}

/**
 * Inference fallback: when cascade returns nothing for a role and
 * there's an enabled provider visible at any scope, suggest the
 * registry's latest-flagship for that role — same heuristic the
 * onboarding seed uses.
 */
async function loadInferenceProvider({
  ctx,
  projectId,
  teamId,
  organizationId,
}: {
  ctx: ReadCtx;
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
}): Promise<string | undefined> {
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
                { scopeType: "PROJECT", scopeId: projectId },
              ],
            },
          },
        },
        select: { provider: true, scopes: { select: { scopeType: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  return providers[0]?.provider;
}

function inheritedForRole({
  role,
  tiers,
  candidateConfigs,
  inferenceProvider,
  inferencePlan,
}: {
  role: ModelRole;
  tiers: CascadeTier[];
  candidateConfigs: CandidateConfigs;
  inferenceProvider: string | undefined;
  inferencePlan: Record<string, string | undefined>;
}): InheritedHit | null {
  const hit = walkTiersForKey({
    tiers,
    candidateConfigs,
    key: role,
    isFeatureKey: false,
  });
  if (hit) return hit;

  const inferredModel = inferencePlan[role];
  if (inferredModel && inferenceProvider) {
    return {
      model: inferredModel,
      source: "inferred",
      scope: null,
      inferredFromProvider: inferenceProvider,
    };
  }
  return null;
}

/**
 * The inherited map: one entry per role, then one per registered
 * feature key. A feature key with no override of its own falls back to
 * whatever its role resolved to.
 */
function buildInheritedValues({
  tiers,
  candidateConfigs,
  features,
  inferenceProvider,
  inferencePlan,
}: {
  tiers: CascadeTier[];
  candidateConfigs: CandidateConfigs;
  features: ReturnType<typeof allFeatures>;
  inferenceProvider: string | undefined;
  inferencePlan: Record<string, string | undefined>;
}): Record<string, InheritedHit | null> {
  const inherited: Record<string, InheritedHit | null> = {};

  for (const role of MODEL_ROLES) {
    inherited[role] = inheritedForRole({
      role,
      tiers,
      candidateConfigs,
      inferenceProvider,
      inferencePlan,
    });
  }

  for (const f of features) {
    inherited[f.key] =
      walkTiersForKey({
        tiers,
        candidateConfigs,
        key: f.key,
        isFeatureKey: true,
      }) ??
      inherited[f.role] ??
      null;
  }

  return inherited;
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

  if (!organizationId) {
    throw new Error("Project has no organization; cannot resolve scopes.");
  }
  await assertScopesInOrganization({
    ctx,
    scopes: params.scopes,
    organizationId,
  });

  const referenceScope = mostSpecificScope(params.scopes);

  const { chainTeamId, chainOrganizationId } = await loadAnchorChain({
    ctx,
    referenceScope,
  });

  const tiers = buildCascadeTiers({
    scopes: params.scopes,
    referenceScope,
    chainTeamId,
    chainOrganizationId,
  });

  const candidateConfigs = await loadCandidateConfigs({
    ctx,
    tiers,
    excludeConfigId: params.excludeConfigId,
  });

  const inferenceProvider = await loadInferenceProvider({
    ctx,
    projectId: params.projectId,
    teamId,
    organizationId,
  });
  const inferencePlan = inferenceProvider
    ? buildSeedPlanForProvider(inferenceProvider)
    : {};

  const inherited = buildInheritedValues({
    tiers,
    candidateConfigs,
    features: allFeatures(),
    inferenceProvider,
    inferencePlan: inferencePlan as Record<string, string | undefined>,
  });

  return {
    inherited,
    referenceScope: {
      scopeType: referenceScope.scopeType,
      scopeId: referenceScope.scopeId,
    },
  };
}
