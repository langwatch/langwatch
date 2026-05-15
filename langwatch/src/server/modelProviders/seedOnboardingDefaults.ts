import type { PrismaClient } from "@prisma/client";

// @ts-ignore - JSON import
import * as llmModelsRaw from "./llmModels.json";

import type { ModelRole } from "./featureRegistry";

interface RegistryEntry {
  id: string;
  provider: string;
  mode: "chat" | "embedding";
}

const REGISTRY = (
  llmModelsRaw as unknown as { models: Record<string, RegistryEntry> }
).models;

/** Picks the newest `openai/gpt-X.Y(-suffix)?` chat model. */
function pickLatestOpenAIChat(suffixFilter: "plain" | "mini"): string | undefined {
  const candidates: { id: string; major: number; minor: number }[] = [];
  for (const model of Object.values(REGISTRY)) {
    if (model.provider !== "openai" || model.mode !== "chat") continue;
    const m = /^openai\/gpt-(\d+)\.(\d+)(-[a-z0-9-]+)?$/.exec(model.id);
    if (!m) continue;
    const [, major, minor, suffix] = m;
    const variant = suffix?.slice(1) ?? "";
    if (suffixFilter === "plain" && variant) continue;
    if (suffixFilter === "mini" && variant !== "mini") continue;
    candidates.push({
      id: model.id,
      major: Number(major),
      minor: Number(minor),
    });
  }
  candidates.sort((a, b) =>
    b.major !== a.major ? b.major - a.major : b.minor - a.minor,
  );
  return candidates[0]?.id;
}

/** Picks the newest `anthropic/claude-<variant>-<major>-<minor>` chat model. */
function pickLatestAnthropicChat(variant: string): string | undefined {
  const candidates: { id: string; major: number; minor: number }[] = [];
  for (const model of Object.values(REGISTRY)) {
    if (model.provider !== "anthropic" || model.mode !== "chat") continue;
    const m = new RegExp(
      `^anthropic\\/claude-${variant}-(\\d+)-(\\d+)$`,
    ).exec(model.id);
    if (!m) continue;
    candidates.push({
      id: model.id,
      major: Number(m[1]),
      minor: Number(m[2]),
    });
  }
  candidates.sort((a, b) =>
    b.major !== a.major ? b.major - a.major : b.minor - a.minor,
  );
  return candidates[0]?.id;
}

function pickLatestEmbedding(provider: string): string | undefined {
  // Embedding model ids don't follow X.Y. Pick the highest version-like
  // number in the id suffix, or fall back to the first model registered.
  const matches = Object.values(REGISTRY)
    .filter((m) => m.provider === provider && m.mode === "embedding")
    .map((m) => m.id);
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => {
    const aN = Number(/\d+/.exec(a.split("/")[1]!)?.[0] ?? 0);
    const bN = Number(/\d+/.exec(b.split("/")[1]!)?.[0] ?? 0);
    return bN - aN;
  });
  return matches[0];
}

interface ProviderSeedPlan {
  default?: string;
  fast?: string;
  embeddings?: string;
}

/**
 * The seed plan for a given provider. Drives onboarding row creation —
 * each populated role gets a ModelDefault row, missing entries are
 * skipped (e.g. Anthropic has no embeddings).
 */
export function buildSeedPlanForProvider(
  provider: string,
): ProviderSeedPlan {
  if (provider === "openai") {
    return {
      default: pickLatestOpenAIChat("plain"),
      fast: pickLatestOpenAIChat("mini"),
      embeddings: pickLatestEmbedding("openai"),
    };
  }
  if (provider === "anthropic") {
    return {
      default: pickLatestAnthropicChat("sonnet"),
      fast: pickLatestAnthropicChat("haiku"),
      // Anthropic ships no embeddings model.
    };
  }
  // No special-case for the provider yet — leave the plan empty so
  // onboarding doesn't seed potentially-wrong defaults. The user can
  // still configure manually.
  return {};
}

const ROLE_FOR_PLAN_FIELD: Record<keyof ProviderSeedPlan, ModelRole> = {
  default: "DEFAULT",
  fast: "FAST",
  embeddings: "EMBEDDINGS",
};

/**
 * Onboarding seed: when a provider gets enabled (typically on the first-
 * provider-setup step of onboarding), populate the three role-level
 * ModelDefault rows for the chosen scope with sensible defaults — the
 * registry's newest flagship / mini / embedding model for that provider.
 *
 * Strictly additive. A role that already has a row at the target scope
 * is left untouched, so a user enabling a second provider later can't
 * silently replace their configured Default model.
 *
 * Skips a role entirely when the provider has no model that fits (e.g.
 * Anthropic + Embeddings).
 */
export async function seedOnboardingDefaultsForProvider(params: {
  prisma: PrismaClient;
  provider: string;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}): Promise<void> {
  const { prisma, provider, scopeType, scopeId } = params;
  const plan = buildSeedPlanForProvider(provider);

  for (const [field, model] of Object.entries(plan)) {
    if (!model) continue;
    const role = ROLE_FOR_PLAN_FIELD[field as keyof ProviderSeedPlan];
    const existing = await prisma.modelDefault.findFirst({
      where: {
        scopeType,
        scopeId,
        role,
        featureKey: null,
      },
    });
    if (existing) continue;
    await prisma.modelDefault.create({
      data: {
        scopeType,
        scopeId,
        role,
        featureKey: null,
        model,
      },
    });
  }
}
