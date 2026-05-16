import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";

import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "../../utils/constants";

import {
  featureByKey,
  type FeatureDescriptor,
  type ModelRole,
} from "./featureRegistry";
import { ModelNotConfiguredError } from "./modelNotConfiguredError";

export type ResolutionSource = "feature_override" | "role_default" | "system";
export type ResolutionScope =
  | "project"
  | "team"
  | "organization"
  | "system"
  | null;

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

/**
 * System-default models for each role. Surfaced as scope="system" when
 * nothing higher in the cascade (or in the legacy B2 columns) has a
 * value, so the UI can render "from System" / "Inherit (System default)"
 * consistently with how env-var-driven model providers are labelled
 * elsewhere. If even this fallback is missing for a role the resolver
 * throws `ModelNotConfiguredError`.
 */
const ROLE_CONSTANT: Record<ModelRole, string | null> = {
  DEFAULT: DEFAULT_MODEL,
  // Topic clustering's existing LLM constant is the most accurate "fast
  // background model" fallback we have today. Per-feature overrides and
  // the role-level default at any scope still take precedence.
  FAST: DEFAULT_TOPIC_CLUSTERING_MODEL,
  EMBEDDINGS: DEFAULT_EMBEDDINGS_MODEL,
};

interface ScopeChain {
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
  /** Legacy columns kept for one-release read fallback. */
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  projectEmbeddingsModel: string | null;
  teamDefaultModel: string | null;
  teamTopicClusteringModel: string | null;
  teamEmbeddingsModel: string | null;
  organizationDefaultModel: string | null;
  organizationTopicClusteringModel: string | null;
  organizationEmbeddingsModel: string | null;
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
      defaultModel: true,
      topicClusteringModel: true,
      embeddingsModel: true,
      team: {
        select: {
          id: true,
          organizationId: true,
          defaultModel: true,
          topicClusteringModel: true,
          embeddingsModel: true,
          organization: {
            select: {
              id: true,
              defaultModel: true,
              topicClusteringModel: true,
              embeddingsModel: true,
            },
          },
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
    organizationId: project.team?.organization?.id ?? null,
    projectDefaultModel: project.defaultModel ?? null,
    projectTopicClusteringModel: project.topicClusteringModel ?? null,
    projectEmbeddingsModel: project.embeddingsModel ?? null,
    teamDefaultModel: project.team?.defaultModel ?? null,
    teamTopicClusteringModel: project.team?.topicClusteringModel ?? null,
    teamEmbeddingsModel: project.team?.embeddingsModel ?? null,
    organizationDefaultModel: project.team?.organization?.defaultModel ?? null,
    organizationTopicClusteringModel:
      project.team?.organization?.topicClusteringModel ?? null,
    organizationEmbeddingsModel:
      project.team?.organization?.embeddingsModel ?? null,
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
  // CSS-cascade: most-specific tier wins. If a single config attaches
  // at multiple tiers in our chain (rare but legal — e.g. org + a
  // specific project), prefer the most specific one when picking the
  // "scope" attribute we surface back to callers.
  const types = new Set(config.scopeTiersHere.map((s) => s.scopeType));
  if (types.has("PROJECT") && config.scopeTiersHere.some(
    (s) => s.scopeType === "PROJECT" && s.scopeId === chain.projectId,
  )) {
    return "project";
  }
  if (types.has("TEAM") && config.scopeTiersHere.some(
    (s) => s.scopeType === "TEAM" && s.scopeId === chain.teamId,
  )) {
    return "team";
  }
  if (types.has("ORGANIZATION")) {
    return "organization";
  }
  return null;
}

function readKey(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const v = config[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

const TIER_ORDER: Array<"project" | "team" | "organization"> = [
  "project",
  "team",
  "organization",
];

function legacyColumnFor(
  chain: ScopeChain,
  role: ModelRole,
  tier: "project" | "team" | "organization",
  featureKey: string,
): string | null {
  // Map a B2 scalar column to the (role, featureKey) it corresponds
  // to. Only the columns whose semantic role matches this feature/role
  // pair contribute to the fallback — we never surface a
  // topicClusteringModel value when resolving AI search, for example.
  if (role === "DEFAULT") {
    if (tier === "project") return chain.projectDefaultModel;
    if (tier === "team") return chain.teamDefaultModel;
    return chain.organizationDefaultModel;
  }
  if (role === "EMBEDDINGS") {
    if (tier === "project") return chain.projectEmbeddingsModel;
    if (tier === "team") return chain.teamEmbeddingsModel;
    return chain.organizationEmbeddingsModel;
  }
  // FAST: the only legacy column we map is topic clustering, and only
  // for the topic-clustering LLM feature itself. AI search, autocomplete,
  // etc. never had a dedicated scalar column, so they inherit nothing
  // from the legacy compat layer.
  if (role === "FAST" && featureKey === "analytics.topic_clustering_llm") {
    if (tier === "project") return chain.projectTopicClusteringModel;
    if (tier === "team") return chain.teamTopicClusteringModel;
    return chain.organizationTopicClusteringModel;
  }
  return null;
}

/**
 * Walk the scope chain + config attachments to return the model a
 * feature should use. See
 * specs/model-providers/model-default-config-cascade.feature for the
 * full contract.
 *
 * Resolution order (CSS-cascade):
 *   1. Tier-by-tier (project → team → org). Within a tier, configs
 *      sorted by createdAt DESC; the first config that has the
 *      featureKey set wins for "feature override", the first that has
 *      the role set wins for "role default". Lower tier always beats
 *      higher tier regardless of recency.
 *   2. Legacy B2 scalar column at project → team → org (compat
 *      fallback; removed in the follow-up PR once writes have drained
 *      off the legacy columns).
 *   3. System role default (scope="system"). Same env-var-style framing
 *      as model providers — never "built-in".
 *   4. ModelNotConfiguredError.
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
        return {
          model: value,
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
        return {
          model: value,
          source: "role_default",
          scope: tier,
          feature,
        };
      }
    }
  }

  // 2. Legacy B2 scalar columns (one-release compat).
  for (const tier of TIER_ORDER) {
    const legacy = legacyColumnFor(chain, feature.role, tier, feature.key);
    if (legacy) {
      return {
        model: legacy,
        source: "role_default",
        scope: tier,
        feature,
      };
    }
  }

  // 3. System default for the role. Surfaced as scope="system" so the
  // UI can label it the same as any other env-var-driven LangWatch
  // primitive instead of inventing a "built-in" concept the user has
  // never met.
  const constant = ROLE_CONSTANT[feature.role];
  if (constant) {
    return {
      model: constant,
      source: "system",
      scope: "system",
      feature,
    };
  }

  // 4. Nothing left to fall back on.
  throw new ModelNotConfiguredError(
    feature.key,
    feature.role,
    feature.displayName,
    ctx.projectId,
  );
}
