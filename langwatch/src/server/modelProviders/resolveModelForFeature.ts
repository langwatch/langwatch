import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";

import { type FeatureDescriptor, featureByKey } from "./featureRegistry";
import { expandLatestAlias, isLatestAlias } from "./latestAliases";
import { ModelNotConfiguredError } from "./modelNotConfiguredError";

export type ResolutionSource = "feature_override" | "role_default";
export type ResolutionScope = "project" | "team" | "organization" | null;

export interface Resolution {
  model: string;
  source: ResolutionSource;
  scope: ResolutionScope;
  feature: FeatureDescriptor;
}

interface Ctx {
  prisma: PrismaClient;
  projectId: string;
}

interface ScopeChain {
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
}

async function loadScopeChain(
  prisma: PrismaClient,
  projectId: string,
): Promise<ScopeChain> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      team: {
        select: {
          id: true,
          organizationId: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found while resolving model.`);
  }

  return {
    projectId: project.id,
    teamId: project.team?.id ?? null,
    organizationId: project.team?.organizationId ?? null,
  };
}

/**
 * One config row + its attachments at scopes inside this resolution's
 * scope chain. The resolver walks tier-by-tier (PROJECT → TEAM → ORG)
 * and within each tier picks the newest config that has the key.
 */
export interface ConfigForChain {
  id: string;
  config: Record<string, unknown>;
  createdAt: Date;
  /** Subset of the config's scope attachments that intersect this chain. */
  scopeTiersHere: Array<{
    scopeType: ModelDefaultScopeType;
    scopeId: string;
  }>;
}

async function loadConfigsForChain(
  prisma: PrismaClient,
  chain: ScopeChain,
): Promise<ConfigForChain[]> {
  const orFilters: Array<{
    scopeType: ModelDefaultScopeType;
    scopeId: string;
  }> = [{ scopeType: "PROJECT", scopeId: chain.projectId }];
  if (chain.teamId) {
    orFilters.push({ scopeType: "TEAM", scopeId: chain.teamId });
  }
  if (chain.organizationId) {
    orFilters.push({
      scopeType: "ORGANIZATION",
      scopeId: chain.organizationId,
    });
  }

  // Pull every config that has at least one scope attachment in our
  // chain, plus all of that config's attachments so we know which tier
  // the row applies at. Returning the full attachment set lets one
  // multi-scope config win at the most-specific scope it's attached
  // to (so an org+team config still beats a project-only config when
  // resolving for a project not in the chain, but at the project tier
  // the project-only config wins because TIER beats tier-ordering).
  const rows = await prisma.modelDefaultConfig.findMany({
    where: {
      scopes: { some: { OR: orFilters } },
    },
    select: {
      id: true,
      config: true,
      createdAt: true,
      scopes: {
        select: {
          scopeType: true,
          scopeId: true,
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    config: (r.config ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
    scopeTiersHere: r.scopes.filter((s) =>
      orFilters.some(
        (f) => f.scopeType === s.scopeType && f.scopeId === s.scopeId,
      ),
    ),
  }));
}

function tierForConfig(
  config: ConfigForChain,
  chain: ScopeChain,
): "project" | "team" | "organization" | null {
  // Cascading: most-specific tier wins. If a single config attaches
  // at multiple tiers in our chain (rare but legal — e.g. org + a
  // specific project), prefer the most specific one when picking the
  // "scope" attribute we surface back to callers.
  const types = new Set(config.scopeTiersHere.map((s) => s.scopeType));
  if (
    types.has("PROJECT") &&
    config.scopeTiersHere.some(
      (s) => s.scopeType === "PROJECT" && s.scopeId === chain.projectId,
    )
  ) {
    return "project";
  }
  if (
    types.has("TEAM") &&
    config.scopeTiersHere.some(
      (s) => s.scopeType === "TEAM" && s.scopeId === chain.teamId,
    )
  ) {
    return "team";
  }
  if (types.has("ORGANIZATION")) {
    return "organization";
  }
  return null;
}

function readKey(config: Record<string, unknown>, key: string): string | null {
  const v = config[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

const TIER_ORDER: Array<"project" | "team" | "organization"> = [
  "project",
  "team",
  "organization",
];

/**
 * Walk the scope chain + config attachments to return the model a
 * feature should use. See
 * specs/model-providers/model-default-config-cascade.feature for the
 * full contract.
 *
 * Resolution order (cascading):
 *   1. Tier-by-tier (project → team → org). Within a tier, configs
 *      sorted by createdAt DESC; the first config that has the
 *      featureKey set wins for "feature override", the first that has
 *      the role set wins for "role default". Lower tier always beats
 *      higher tier regardless of recency.
 *   2. ModelNotConfiguredError.
 *
 * There is intentionally no global system fallback and no legacy
 * scalar-column compat tier. If nothing is configured at any scope, AI
 * features for that role are disabled until the user configures a
 * default. The frontend's tRPC interceptor maps the thrown error to a
 * sticky toast prompting the user to update their defaults.
 */
export async function resolveModelForFeature(
  featureKey: string,
  ctx: Ctx,
): Promise<Resolution> {
  const feature = featureByKey(featureKey);
  if (!feature) {
    throw new Error(`Unknown feature key: "${featureKey}".`);
  }

  const chain = await loadScopeChain(ctx.prisma, ctx.projectId);
  const configs = await loadConfigsForChain(ctx.prisma, chain);

  // Walk tiers in specificity order (project most specific). At each
  // tier, sort configs attached to THIS tier by createdAt DESC and
  // pick the first one carrying a value for the feature key (override)
  // or the role key (role default). Feature-key match beats role-key
  // match at the same tier.
  for (const tier of TIER_ORDER) {
    const tierConfigs = configs.filter((c) => tierForConfig(c, chain) === tier);
    if (tierConfigs.length === 0) continue;
    tierConfigs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // 1a. Per-feature override at this tier.
    for (const c of tierConfigs) {
      const value = readKey(c.config, feature.key);
      if (value) {
        // Aliases like `openai/latest` resolve to the registry flagship
        // here so downstream consumers (litellm, aigateway, nlp) only
        // ever see concrete model ids. Non-alias values pass through.
        // If an alias has no concrete resolution in the current catalog
        // (e.g. a provider added later but the flagship hasn't shipped
        // yet), skip this entry and let the cascade continue rather
        // than leak a virtual id downstream.
        const expanded = expandLatestAlias(value);
        if (isLatestAlias(value) && expanded === value) continue;
        return {
          model: expanded,
          source: "feature_override",
          scope: tier,
          feature,
        };
      }
    }
    // 1b. Role-level value at this tier.
    for (const c of tierConfigs) {
      const value = readKey(c.config, feature.role);
      if (value) {
        const expanded = expandLatestAlias(value);
        if (isLatestAlias(value) && expanded === value) continue;
        return {
          model: expanded,
          source: "role_default",
          scope: tier,
          feature,
        };
      }
    }
  }

  // 2. Nothing in the cascade. AI features for this role are disabled
  // until the user configures a default.
  throw new ModelNotConfiguredError(
    feature.key,
    feature.role,
    feature.displayName,
    ctx.projectId,
  );
}

/**
 * Walk the cascade for `featureKey` while skipping any tier at or above
 * `skipFromTier` — used by `getVercelAIModel` to suggest the
 * cascade-next candidate when the chosen one's provider is disabled.
 * Returns `null` when no further candidate exists (the disabled tier was
 * the only configured one).
 *
 * Distinct from `resolveModelForFeature` so the swap-suggestion path
 * doesn't pay the throw + catch overhead of the primary resolver, and
 * so the "alternate" walk can't itself raise ModelNotConfiguredError
 * (we already know the primary tier resolved — `null` is fine).
 */
export async function findAlternateBelowScope(
  featureKey: string,
  ctx: Ctx,
  skipFromTier: Exclude<ResolutionScope, null>,
): Promise<Resolution | null> {
  const feature = featureByKey(featureKey);
  if (!feature) return null;

  const chain = await loadScopeChain(ctx.prisma, ctx.projectId);
  const configs = await loadConfigsForChain(ctx.prisma, chain);

  const skipIndex = TIER_ORDER.indexOf(skipFromTier);
  if (skipIndex < 0) return null;
  const tiersBelow = TIER_ORDER.slice(skipIndex + 1);

  for (const tier of tiersBelow) {
    const tierConfigs = configs.filter((c) => tierForConfig(c, chain) === tier);
    if (tierConfigs.length === 0) continue;
    tierConfigs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    for (const c of tierConfigs) {
      const value = readKey(c.config, feature.key);
      if (value) {
        const expanded = expandLatestAlias(value);
        if (isLatestAlias(value) && expanded === value) continue;
        return {
          model: expanded,
          source: "feature_override",
          scope: tier,
          feature,
        };
      }
    }
    for (const c of tierConfigs) {
      const value = readKey(c.config, feature.role);
      if (value) {
        const expanded = expandLatestAlias(value);
        if (isLatestAlias(value) && expanded === value) continue;
        return {
          model: expanded,
          source: "role_default",
          scope: tier,
          feature,
        };
      }
    }
  }

  return null;
}
