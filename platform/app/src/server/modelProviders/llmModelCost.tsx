import type { PrismaClient } from "~/generated/prisma/client";
import { prisma } from "../db";
import { resolveScopeChain } from "../scopes/resolveScopeChain";
import type { ScopeTier } from "../scopes/scope.types";
import { isCodexModel } from "./codexRestrictions";
import { llmModels } from "./loadModelCatalog";

// Inlined from escape-string-regexp to preserve the previous escaping behavior.
function escapeStringRegexp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

/**
 * Anthropic prices an hour-long prompt-cache entry at twice the input rate,
 * against 1.25x for the five-minute one it publishes as a single "cache write"
 * price. The upstream catalog carries only that short-lived rate, so without
 * this an hour-long write is billed at 1.25x and a cache-heavy session comes
 * out around a third under what the provider charged.
 *
 * Derived rather than hardcoded per model, and only when the catalog has not
 * supplied the real figure, so a future sync carrying `inputCacheWrite1hPerToken`
 * wins without a code change. Keyed off the model id because the catalog spells
 * the aliases `~anthropic/...`; models reached through Bedrock or Vertex match
 * back to these same entries, so they inherit it.
 *
 * Source: Anthropic's prompt-caching pricing (1h cache write = 2x base input).
 */
const ANTHROPIC_MODEL_ID = /^~?anthropic\//;
const ANTHROPIC_1H_CACHE_WRITE_MULTIPLIER = 2;

export function resolveCacheWrite1hRate(
  modelId: string,
  pricing: {
    inputCostPerToken?: number;
    inputCacheWritePerToken?: number;
    inputCacheWrite1hPerToken?: number;
  },
): number | undefined {
  if (pricing.inputCacheWrite1hPerToken != null) {
    return pricing.inputCacheWrite1hPerToken;
  }
  if (!ANTHROPIC_MODEL_ID.test(modelId)) return undefined;
  // A model with no short-lived cache-write price is not cache-priced at all,
  // so there is nothing to scale.
  if (pricing.inputCacheWritePerToken == null) return undefined;
  if (pricing.inputCostPerToken == null) return undefined;
  return pricing.inputCostPerToken * ANTHROPIC_1H_CACHE_WRITE_MULTIPLIER;
}

/**
 * OpenAI prices audio output at twice audio input across its audio-native
 * families: $64 against $32 per million tokens on gpt-audio and gpt-realtime,
 * $20 against $10 on their mini variants. The upstream catalog carries only
 * the input side (`audioCostPerToken`), so without this an audio answer is
 * billed at half what the provider charged.
 *
 * Derived rather than hardcoded per model, and only when the catalog has not
 * supplied the real figure, so a future sync carrying `audioOutputCostPerToken`
 * wins without a code change. Keyed off the model id because the catalog
 * spells the aliases `~openai/...`.
 *
 * Source: OpenAI's API pricing page (audio output = 2x audio input).
 */
const OPENAI_AUDIO_MODEL_ID = /^~?openai\/(gpt-audio|gpt-realtime)/;
const OPENAI_AUDIO_OUTPUT_MULTIPLIER = 2;

export function resolveAudioOutputRate(
  modelId: string,
  pricing: {
    audioCostPerToken?: number;
    audioOutputCostPerToken?: number;
  },
): number | undefined {
  if (pricing.audioOutputCostPerToken != null) {
    return pricing.audioOutputCostPerToken;
  }
  if (!OPENAI_AUDIO_MODEL_ID.test(modelId)) return undefined;
  // A model with no audio input price is not audio-priced at all, so there is
  // nothing to scale.
  if (pricing.audioCostPerToken == null) return undefined;
  return pricing.audioCostPerToken * OPENAI_AUDIO_OUTPUT_MULTIPLIER;
}

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
      cacheCreation1hCostPerToken?: number;
      inputAudioCostPerToken?: number;
      outputAudioCostPerToken?: number;
      inputImageCostPerToken?: number;
      outputImageCostPerToken?: number;
      inputCostPerCharacter?: number;
      inputCostPerSecond?: number;
    }
  > = {};

  for (const [modelId, model] of Object.entries(models)) {
    // Codex models bill the user's ChatGPT plan, so the catalog prices them
    // at zero. A zero-rate entry can never price a span; all it would do is
    // shadow the identically named `openai/<model>` entry (the generated
    // regexes make the vendor prefix optional, so both the bare and the
    // codex-prefixed spellings hit it first). Keeping codex out of the cost
    // registry lets codex usage price from the underlying OpenAI entry,
    // which is what the bundled-cost presentation shows.
    if (isCodexModel(modelId)) continue;
    if (
      model.pricing?.inputCostPerToken != null ||
      model.pricing?.outputCostPerToken != null ||
      model.pricing?.inputCostPerCharacter != null ||
      model.pricing?.inputCostPerSecond != null ||
      model.pricing?.audioCostPerToken != null ||
      model.pricing?.imageCostPerToken != null ||
      model.pricing?.imageOutputCostPerToken != null
    ) {
      // Make vendor prefix optional in regex (e.g., both "gpt-4o" and "openai/gpt-4o" should match)
      const hasVendorPrefix = modelId.includes("/");
      const vendorPrefix = hasVendorPrefix ? modelId.split("/")[0] : null;
      const modelName = hasVendorPrefix
        ? modelId.split("/").slice(1).join("/")
        : modelId;

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
        cacheCreation1hCostPerToken: resolveCacheWrite1hRate(
          modelId,
          model.pricing,
        ),
        inputAudioCostPerToken: model.pricing.audioCostPerToken,
        outputAudioCostPerToken: resolveAudioOutputRate(modelId, model.pricing),
        inputImageCostPerToken: model.pricing.imageCostPerToken,
        outputImageCostPerToken: model.pricing.imageOutputCostPerToken,
        inputCostPerCharacter: model.pricing.inputCostPerCharacter,
        inputCostPerSecond: model.pricing.inputCostPerSecond,
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
        cacheCreation1hCostPerToken: model.cacheCreation1hCostPerToken,
        inputAudioCostPerToken: model.inputAudioCostPerToken,
        outputAudioCostPerToken: model.outputAudioCostPerToken,
        inputImageCostPerToken: model.inputImageCostPerToken,
        outputImageCostPerToken: model.outputImageCostPerToken,
        inputCostPerCharacter: model.inputCostPerCharacter,
        inputCostPerSecond: model.inputCostPerSecond,
      };
    });

  // Exclude models with no costs
  const paidModels = mergedModels.filter(
    (model) =>
      model.inputCostPerToken != null ||
      model.outputCostPerToken != null ||
      model.inputCostPerCharacter != null ||
      model.inputCostPerSecond != null ||
      model.inputAudioCostPerToken != null ||
      model.inputImageCostPerToken != null ||
      model.outputImageCostPerToken != null,
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
  // below the input rate (~0.1x); write tokens above it. A write is priced by
  // how long its entry lives: `cacheCreationCostPerToken` is the short-lived
  // rate (Anthropic's 5 minute entry, ~1.25x input) and
  // `cacheCreation1hCostPerToken` the hour-long one (~2x input). A span says
  // which bucket its write tokens fell into; without that, the short-lived
  // rate applies, and an absent hour-long rate falls back to it, so a model
  // that never had the distinction prices exactly as it did before. The static
  // registry sources these from the catalog; custom overrides may set them too.
  // When a cache rate is absent entirely, those tokens fall back to the input
  // rate (counted, just not discounted).
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  cacheCreation1hCostPerToken?: number;
  // Per-token rates for audio tokens, which realtime and audio-native models
  // bill several times above text: OpenAI charges $32 per million audio input
  // tokens against $4 for text on gpt-realtime, and twice the audio input rate
  // for audio output. The counts these price are disjoint from the text token
  // counts. When an audio rate is absent, those tokens fall back to the
  // matching text rate, so a model with no audio price bills a split payload
  // exactly as it billed the flat total.
  inputAudioCostPerToken?: number;
  outputAudioCostPerToken?: number;
  // Per-token rates for image tokens on the token-billed image models.
  // OpenAI bills gpt-image output image tokens at $30 to $40 per million
  // against $5 for text input, so an image priced off a flat token total
  // comes out a fraction of what it cost. The counts these price are
  // disjoint from the text token counts and, unlike the audio rates, there
  // is no text fallback: a model with no image rate prices image tokens at
  // zero, so a chat model never bills pixels it cannot produce.
  inputImageCostPerToken?: number;
  outputImageCostPerToken?: number;
  // Audio rates: characters synthesized (TTS) and seconds transcribed
  // (STT), matched against the gateway's gen_ai.usage.input_chars /
  // gen_ai.usage.audio_seconds span attributes.
  inputCostPerCharacter?: number;
  inputCostPerSecond?: number;
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
        cacheCreation1hCostPerToken: value.cacheCreation1hCostPerToken,
        inputAudioCostPerToken: value.inputAudioCostPerToken,
        outputAudioCostPerToken: value.outputAudioCostPerToken,
        inputImageCostPerToken: value.inputImageCostPerToken,
        outputImageCostPerToken: value.outputImageCostPerToken,
        inputCostPerCharacter: value.inputCostPerCharacter,
        inputCostPerSecond: value.inputCostPerSecond,
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

/**
 * Resolves the custom cost overrides that apply to a project, most specific
 * first (PROJECT, then TEAM, then ORGANIZATION; newest first within a tier).
 * Static catalog entries are NOT included — callers that want the full
 * cascade with platform defaults use getLLMModelCosts.
 *
 * Accepts an injectable Prisma client so ingestion-side services can pass
 * their own instance.
 */
export const getCustomLLMModelCosts = async ({
  projectId,
  prismaClient = prisma,
}: {
  projectId: string;
  prismaClient?: PrismaClient;
}): Promise<MaybeStoredLLMModelCost[]> => {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      teamId: true,
      team: { select: { organizationId: true } },
    },
  });

  // No project context means no custom overrides apply; never fall back to
  // an unscoped read that could leak another tenant's costs.
  if (!project) return [];

  const organizationId = project.team.organizationId;
  const chain = resolveScopeChain({
    organizationId,
    teamId: project.teamId,
    projectId,
  });

  const llmModelCostsCustomData =
    await prismaClient.customLLMModelCost.findMany({
      where: {
        organizationId,
        OR: chain.map((scope) => ({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
        })),
      },
    });

  return llmModelCostsCustomData
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
          cacheCreation1hCostPerToken:
            record.cacheCreation1hCostPerToken ?? undefined,
          updatedAt: record.updatedAt,
          createdAt: record.createdAt,
        }) as MaybeStoredLLMModelCost,
    )
    .sort(
      (a, b) =>
        SCOPE_TIER_RANK[a.scopeType!] - SCOPE_TIER_RANK[b.scopeType!] ||
        b.createdAt!.getTime() - a.createdAt!.getTime(),
    );
};

export const getLLMModelCosts = async ({
  projectId,
}: {
  projectId: string;
}): Promise<MaybeStoredLLMModelCost[]> => {
  const customCosts = await getCustomLLMModelCosts({ projectId });
  return [...customCosts, ...getStaticModelCosts()];
};
