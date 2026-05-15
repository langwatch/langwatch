import type { PrismaClient } from "@prisma/client";

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

export type ResolutionSource = "feature_override" | "role_default" | "constant";
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

/**
 * Built-in constants for each role. Used as the last fallback before the
 * resolver throws `ModelNotConfiguredError`. Keeping them centralised
 * makes it obvious where the safety net lives, and the eventual A11y of
 * the auto-latest-flagship value (PR #4068) flows through `DEFAULT_MODEL`
 * once that lands on main.
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

interface ModelDefaultRow {
  scopeType: string;
  scopeId: string;
  role: string;
  featureKey: string | null;
  model: string;
}

async function loadDefaultsForChain(
  prisma: PrismaClient,
  chain: ScopeChain,
  role: ModelRole,
  featureKey: string,
): Promise<ModelDefaultRow[]> {
  const scopes: { scopeType: string; scopeId: string }[] = [
    { scopeType: "PROJECT", scopeId: chain.projectId },
  ];
  if (chain.teamId) {
    scopes.push({ scopeType: "TEAM", scopeId: chain.teamId });
  }
  if (chain.organizationId) {
    scopes.push({ scopeType: "ORGANIZATION", scopeId: chain.organizationId });
  }

  // One query, both role-level and feature-override rows for the chain.
  return await prisma.modelDefault.findMany({
    where: {
      role,
      OR: scopes,
      AND: [{ OR: [{ featureKey: null }, { featureKey }] }],
    },
    select: {
      scopeType: true,
      scopeId: true,
      role: true,
      featureKey: true,
      model: true,
    },
  });
}

function pickRow(
  rows: ModelDefaultRow[],
  predicate: (r: ModelDefaultRow) => boolean,
): ModelDefaultRow | undefined {
  return rows.find(predicate);
}

function scopeOrder(): ("PROJECT" | "TEAM" | "ORGANIZATION")[] {
  return ["PROJECT", "TEAM", "ORGANIZATION"];
}

function scopeIdForType(
  chain: ScopeChain,
  scopeType: "PROJECT" | "TEAM" | "ORGANIZATION",
): string | null {
  if (scopeType === "PROJECT") return chain.projectId;
  if (scopeType === "TEAM") return chain.teamId;
  return chain.organizationId;
}

function legacyColumnFor(
  chain: ScopeChain,
  role: ModelRole,
  scopeType: "PROJECT" | "TEAM" | "ORGANIZATION",
  featureKey: string,
): string | null {
  // Map a B2 scalar column to the (role, featureKey) it corresponds to.
  // Only the columns whose semantic role matches this feature/role pair
  // contribute to the fallback. Everything else returns null so we don't
  // surface, say, a topicClusteringModel value when resolving AI search.
  if (role === "DEFAULT") {
    if (scopeType === "PROJECT") return chain.projectDefaultModel;
    if (scopeType === "TEAM") return chain.teamDefaultModel;
    return chain.organizationDefaultModel;
  }
  if (role === "EMBEDDINGS") {
    if (scopeType === "PROJECT") return chain.projectEmbeddingsModel;
    if (scopeType === "TEAM") return chain.teamEmbeddingsModel;
    return chain.organizationEmbeddingsModel;
  }
  // FAST: the only legacy column we map is topic clustering, and only for
  // the topic-clustering LLM feature itself. AI search, autocomplete, etc.
  // never had a dedicated scalar column, so they have nothing to inherit.
  if (
    role === "FAST" &&
    featureKey === "analytics.topic_clustering_llm"
  ) {
    if (scopeType === "PROJECT") return chain.projectTopicClusteringModel;
    if (scopeType === "TEAM") return chain.teamTopicClusteringModel;
    return chain.organizationTopicClusteringModel;
  }
  return null;
}

/**
 * Walk the scope chain + role + per-feature override storage to return
 * the model a feature should use. See
 * specs/model-providers/model-resolver-and-registry.feature for the full
 * contract.
 *
 * Resolution order (most-specific wins):
 *   1. Per-feature override row at PROJECT → TEAM → ORGANIZATION
 *   2. Role-level row at PROJECT → TEAM → ORGANIZATION
 *   3. Legacy B2 scalar column at PROJECT → TEAM → ORGANIZATION
 *      (compat fallback; removed in the follow-up PR once writes have
 *      drained off the legacy columns)
 *   4. Built-in role constant
 *   5. ModelNotConfiguredError
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
  const rows = await loadDefaultsForChain(
    ctx.prisma,
    chain,
    feature.role,
    feature.key,
  );

  // 1. Per-feature override (project → team → org).
  for (const scopeType of scopeOrder()) {
    const scopeId = scopeIdForType(chain, scopeType);
    if (!scopeId) continue;
    const override = pickRow(
      rows,
      (r) =>
        r.scopeType === scopeType &&
        r.scopeId === scopeId &&
        r.featureKey === feature.key,
    );
    if (override) {
      return {
        model: override.model,
        source: "feature_override",
        scope: scopeType.toLowerCase() as ResolutionScope,
        feature,
      };
    }
  }

  // 2. Role-level default (project → team → org).
  for (const scopeType of scopeOrder()) {
    const scopeId = scopeIdForType(chain, scopeType);
    if (!scopeId) continue;
    const roleRow = pickRow(
      rows,
      (r) =>
        r.scopeType === scopeType &&
        r.scopeId === scopeId &&
        r.featureKey === null,
    );
    if (roleRow) {
      return {
        model: roleRow.model,
        source: "role_default",
        scope: scopeType.toLowerCase() as ResolutionScope,
        feature,
      };
    }
  }

  // 3. Legacy B2 scalar columns (one-release compat).
  for (const scopeType of scopeOrder()) {
    const legacy = legacyColumnFor(chain, feature.role, scopeType, feature.key);
    if (legacy) {
      return {
        model: legacy,
        source: "role_default",
        scope: scopeType.toLowerCase() as ResolutionScope,
        feature,
      };
    }
  }

  // 4. Built-in role constant.
  const constant = ROLE_CONSTANT[feature.role];
  if (constant) {
    return {
      model: constant,
      source: "constant",
      scope: null,
      feature,
    };
  }

  // 5. Nothing left to fall back on.
  throw new ModelNotConfiguredError(
    feature.key,
    feature.role,
    feature.displayName,
    ctx.projectId,
  );
}
