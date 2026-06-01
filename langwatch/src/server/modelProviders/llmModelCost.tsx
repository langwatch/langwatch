import escapeStringRegexp from "escape-string-regexp";
import { prisma } from "../db";
import { resolveScopeChain } from "../scopes/resolveScopeChain";
import type { ScopeTier } from "../scopes/scope.types";
import { llmModels } from "./loadModelCatalog";

const getImportedModelCosts = () => {
  const models = llmModels.models;

  // Convert models to cost entries with regex patterns
  const tokenModels: Record<
    string,
    {
      regex: string;
      inputCostPerToken: number;
      outputCostPerToken: number;
      cacheReadCostPerToken?: number;
      cacheCreationCostPerToken?: number;
    }
  > = {};

  for (const [modelId, model] of Object.entries(models)) {
    if (
      model.pricing?.inputCostPerToken != null ||
      model.pricing?.outputCostPerToken != null
    ) {
      // Make vendor prefix optional in regex (e.g., both "gpt-4o" and "openai/gpt-4o" should match)
      const hasVendorPrefix = modelId.includes("/");
      const vendorPrefix = hasVendorPrefix ? modelId.split("/")[0] : null;
      const modelName = hasVendorPrefix ? modelId.split("/").slice(1).join("/") : modelId;

      const escapedModelName = escapeStringRegexp(modelName)
        // Convert hex-escaped hyphens (\x2d) and escaped hyphens (\-) to literal hyphens
        .replaceAll("\\x2d", "-")
        .replaceAll("\\-", "-")
        // Fix for langchain using vertexai while litellm uses vertex_ai
        .replace("vertex_ai", "(vertex_ai|vertexai)")
        // Allow version numbers to use either dots or hyphens (e.g., "4.6" or "4-6")
        .replaceAll("\\.", "[.-]")
        .replace(/(\d)-(\d)/g, "$1[.-]$2");

      const escapedVendorPrefix = hasVendorPrefix
        ? escapeStringRegexp(vendorPrefix!)
            .replaceAll("\\x2d", "-")
            .replaceAll("\\-", "-")
        : "";

      const regex = hasVendorPrefix
        ? `^(${escapedVendorPrefix}\\/)?${escapedModelName}`
        : `^${escapedModelName}`;

      tokenModels[modelId] = {
        regex,
        inputCostPerToken: model.pricing.inputCostPerToken ?? 0,
        outputCostPerToken: model.pricing.outputCostPerToken ?? 0,
        cacheReadCostPerToken: model.pricing.inputCacheReadPerToken,
        cacheCreationCostPerToken: model.pricing.inputCacheWritePerToken,
      };
    }
  }

  // Exclude models with : after it if there is already the same model there without the :
  const mergedModels = Object.entries(tokenModels)
    .filter(([model_name, _]) => {
      if (
        model_name.includes(":") &&
        model_name.split(":")[0]! in tokenModels
      ) {
        return false;
      }
      return true;
    })
    .map(([model_name, model]) => {
      return {
        model: model_name,
        regex: model.regex,
        inputCostPerToken: model.inputCostPerToken,
        outputCostPerToken: model.outputCostPerToken,
        cacheReadCostPerToken: model.cacheReadCostPerToken,
        cacheCreationCostPerToken: model.cacheCreationCostPerToken,
      };
    });

  // Exclude models with no costs
  const paidModels = mergedModels.filter(
    (model) =>
      model.inputCostPerToken != null || model.outputCostPerToken != null,
  );

  // Exclude some vendors (openrouter is already excluded as we're using their API)
  const relevantModels = paidModels.filter(
    (model) => !model.model.includes("openrouter/"),
  );

  return Object.fromEntries(
    relevantModels.map((model) => [model.model, model]),
  );
};

export type MaybeStoredLLMModelCost = {
  id?: string;
  projectId: string;
  scopeType?: ScopeTier;
  scopeId?: string;
  model: string;
  regex: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  // Per-token rates for prompt-cache tokens. Read tokens are billed far
  // below the input rate (~0.1x); write tokens above it (~1.25x/2x). The
  // static registry sources these from the catalog's inputCacheReadPerToken /
  // inputCacheWritePerToken; custom overrides may set them too. When absent,
  // cache tokens fall back to the input rate (counted, just not discounted).
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  updatedAt?: Date;
  createdAt?: Date;
};

let cachedStaticModelCosts: MaybeStoredLLMModelCost[] | null = null;

const getStaticSpecificityKey = (model: string) =>
  model.includes("/") ? model.split("/").slice(1).join("/") : model;

/**
 * Returns static model costs from llmModels.json (no DB query).
 * Cached at module level since the JSON registry is immutable at runtime.
 */
export const getStaticModelCosts = (): MaybeStoredLLMModelCost[] => {
  if (!cachedStaticModelCosts) {
    const importedData = getImportedModelCosts();
    cachedStaticModelCosts = Object.entries(importedData)
      .map(([key, value]) => ({
        projectId: "",
        model: key,
        regex: value.regex,
        inputCostPerToken: value.inputCostPerToken,
        outputCostPerToken: value.outputCostPerToken,
        cacheReadCostPerToken: value.cacheReadCostPerToken,
        cacheCreationCostPerToken: value.cacheCreationCostPerToken,
      }))
      // Sort by the matched model suffix, not raw registry key length,
      // because vendor prefixes are optional in the generated regex.
      .sort((a, b) => {
        const aKey = getStaticSpecificityKey(a.model);
        const bKey = getStaticSpecificityKey(b.model);

        return (
          bKey.length - aKey.length ||
          Number(a.model.includes("/")) - Number(b.model.includes("/"))
        );
      });
  }
  return cachedStaticModelCosts;
};

// Most-specific tier wins: a PROJECT override shadows a TEAM override, which
// shadows an ORGANIZATION override, which shadows the static default. Within a
// tier the newest row wins.
const SCOPE_TIER_RANK: Record<ScopeTier, number> = {
  PROJECT: 0,
  TEAM: 1,
  ORGANIZATION: 2,
};

export const getLLMModelCosts = async ({
  projectId,
}: {
  projectId: string;
}): Promise<MaybeStoredLLMModelCost[]> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      team: { select: { organizationId: true } },
    },
  });

  // No project context means no custom overrides apply; fall back to the
  // static catalog rather than leaking another tenant's costs.
  if (!project) return getStaticModelCosts();

  const organizationId = project.team.organizationId;
  const chain = resolveScopeChain({
    organizationId,
    teamId: project.teamId,
    projectId,
  });

  const llmModelCostsCustomData = await prisma.customLLMModelCost.findMany({
    where: {
      organizationId,
      OR: chain.map((scope) => ({
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      })),
    },
  });

  const customCosts = llmModelCostsCustomData
    .map(
      (record) =>
        ({
          id: record.id,
          projectId,
          scopeType: record.scopeType,
          scopeId: record.scopeId,
          model: record.model,
          regex: record.regex,
          inputCostPerToken: record.inputCostPerToken ?? undefined,
          outputCostPerToken: record.outputCostPerToken ?? undefined,
          cacheReadCostPerToken: record.cacheReadCostPerToken ?? undefined,
          cacheCreationCostPerToken:
            record.cacheCreationCostPerToken ?? undefined,
          updatedAt: record.updatedAt,
          createdAt: record.createdAt,
        }) as MaybeStoredLLMModelCost,
    )
    .sort(
      (a, b) =>
        SCOPE_TIER_RANK[a.scopeType!] - SCOPE_TIER_RANK[b.scopeType!] ||
        b.createdAt!.getTime() - a.createdAt!.getTime(),
    );

  return [...customCosts, ...getStaticModelCosts()];
};
