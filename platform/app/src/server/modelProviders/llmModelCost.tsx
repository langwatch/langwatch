import {
  getStaticModelCostRates,
  resolveAudioOutputRate,
  resolveCacheWrite1hRate,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma } from "../db";
import { resolveScopeChain } from "../scopes/resolveScopeChain";
import type { ScopeTier } from "../scopes/scope.types";

export { resolveAudioOutputRate, resolveCacheWrite1hRate };

export type MaybeStoredLLMModelCost = ModelCostRate & {
  id?: string;
  projectId: string;
  scopeType?: ScopeTier;
  scopeId?: string;
  updatedAt?: Date;
  createdAt?: Date;
};

let cachedStaticModelCosts: MaybeStoredLLMModelCost[] | null = null;

export function getStaticModelCosts(): MaybeStoredLLMModelCost[] {
  if (!cachedStaticModelCosts) {
    cachedStaticModelCosts = getStaticModelCostRates().map((rate) => ({
      ...rate,
      projectId: "",
    }));
  }

  return cachedStaticModelCosts;
}

const SCOPE_TIER_RANK: Record<ScopeTier, number> = {
  PROJECT: 0,
  TEAM: 1,
  ORGANIZATION: 2,
};

export async function getCustomLLMModelCosts({
  projectId,
  prismaClient = prisma,
}: {
  projectId: string;
  prismaClient?: PrismaClient;
}): Promise<MaybeStoredLLMModelCost[]> {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      team: { select: { organizationId: true } },
    },
  });
  if (!project) {
    return [];
  }

  const organizationId = project.team.organizationId;
  const chain = resolveScopeChain({
    organizationId,
    teamId: project.teamId,
    projectId,
  });
  const rows = await prismaClient.customLLMModelCost.findMany({
    where: {
      organizationId,
      OR: chain.map((scope) => ({
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      })),
    },
  });

  return rows
    .map((row): MaybeStoredLLMModelCost => ({
      id: row.id,
      projectId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      model: row.model,
      regex: row.regex,
      inputCostPerToken: row.inputCostPerToken ?? void 0,
      outputCostPerToken: row.outputCostPerToken ?? void 0,
      cacheReadCostPerToken: row.cacheReadCostPerToken ?? void 0,
      cacheCreationCostPerToken: row.cacheCreationCostPerToken ?? void 0,
      cacheCreation1hCostPerToken: row.cacheCreation1hCostPerToken ?? void 0,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    }))
    .sort(compareScopedCosts);
}

export async function getLLMModelCosts({
  projectId,
}: {
  projectId: string;
}): Promise<MaybeStoredLLMModelCost[]> {
  const customCosts = await getCustomLLMModelCosts({ projectId });
  return [...customCosts, ...getStaticModelCosts()];
}

function compareScopedCosts(
  left: MaybeStoredLLMModelCost,
  right: MaybeStoredLLMModelCost,
): number {
  const leftRank = left.scopeType ? SCOPE_TIER_RANK[left.scopeType] : Number.MAX_VALUE;
  const rightRank = right.scopeType ? SCOPE_TIER_RANK[right.scopeType] : Number.MAX_VALUE;
  const leftCreatedAt = left.createdAt?.getTime() ?? 0;
  const rightCreatedAt = right.createdAt?.getTime() ?? 0;

  return leftRank - rightRank || rightCreatedAt - leftCreatedAt;
}
