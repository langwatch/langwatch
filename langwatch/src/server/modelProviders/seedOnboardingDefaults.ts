import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";

// @ts-ignore - JSON import
import * as llmModelsRaw from "./llmModels.json";

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

/**
 * Picks the newest Gemini chat model in the requested family. Gemini
 * ids look like `gemini/gemini-<major>.<minor>-<variant>` or
 * `gemini/gemini-<major>.<minor>-<variant>-preview`. We sort numerically
 * on (major, minor) so the latest version wins regardless of the
 * "-preview" suffix.
 *
 * Variants we care about:
 *   - "pro" (or "pro-preview"): the flagship, used for DEFAULT
 *   - "flash" or "flash-lite": the mini, used for FAST
 *
 * Matching is permissive on the suffix so `gemini-3.1-pro-preview`
 * beats `gemini-3.0-pro` even though the former has the longer
 * suffix.
 */
function pickLatestGeminiChat(family: "pro" | "flash"): string | undefined {
  const candidates: { id: string; major: number; minor: number }[] = [];
  for (const model of Object.values(REGISTRY)) {
    if (model.provider !== "gemini" || model.mode !== "chat") continue;
    const m = /^gemini\/gemini-(\d+)\.(\d+)-([a-z-]+)$/.exec(model.id);
    if (!m) continue;
    const [, major, minor, suffix] = m;
    // "pro" matches "pro", "pro-preview". "flash" matches "flash",
    // "flash-lite", "flash-thinking", etc. Most-specific family wins:
    // if the caller asks for flash, don't match pro-flash hybrids.
    const matchesFamily =
      family === "pro"
        ? /^pro(-|$)/.test(suffix!)
        : /^flash(-|$)/.test(suffix!);
    if (!matchesFamily) continue;
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
  DEFAULT?: string;
  FAST?: string;
  EMBEDDINGS?: string;
}

/**
 * The seed plan for a given provider. Each populated role becomes a
 * top-level key in the seeded ModelDefaultConfig's JSON. Missing roles
 * are skipped — Anthropic, for instance, has no embeddings model, so
 * EMBEDDINGS stays absent (= "inherit from parent scope", which at
 * org-scope means "fall back to the built-in role constant").
 */
export function buildSeedPlanForProvider(
  provider: string,
): ProviderSeedPlan {
  if (provider === "openai") {
    return {
      DEFAULT: pickLatestOpenAIChat("plain"),
      FAST: pickLatestOpenAIChat("mini"),
      EMBEDDINGS: pickLatestEmbedding("openai"),
    };
  }
  if (provider === "anthropic") {
    // Anthropic's haiku trails sonnet by a wide enough margin on the
    // tasks we hit (search, autocomplete, topic clustering) that users
    // are better served by sonnet across the board. Both roles point
    // at the latest sonnet; per-feature overrides can still narrow it.
    const sonnet = pickLatestAnthropicChat("sonnet");
    return {
      DEFAULT: sonnet,
      FAST: sonnet,
      // Anthropic ships no embeddings model.
    };
  }
  if (provider === "gemini") {
    return {
      DEFAULT: pickLatestGeminiChat("pro"),
      FAST: pickLatestGeminiChat("flash"),
      EMBEDDINGS: pickLatestEmbedding("gemini"),
    };
  }
  // No special-case for the provider yet — leave the plan empty so
  // onboarding doesn't seed potentially-wrong defaults. The user can
  // still configure manually.
  return {};
}

/**
 * Onboarding seed: when a provider is enabled at a scope, ensure that
 * scope has a ModelDefaultConfig with sensible role-level values for
 * roles the provider can fulfill. Strictly additive:
 *
 *   - If no config is attached to (scopeType, scopeId), one is created
 *     with the seed plan's roles. Default scope: ORGANIZATION (per
 *     rchaves's directive — onboarding seeds at org level so the
 *     entire organization inherits, not just the first project).
 *   - If a config is already attached at the same scope, it is left
 *     untouched. We do NOT merge in missing keys, because the user
 *     may have intentionally cleared a key to inherit from a higher
 *     scope; re-seeding would silently re-set it.
 *
 * Skips a role entirely when the provider has no model for it (e.g.
 * Anthropic + EMBEDDINGS).
 */
export async function seedOnboardingDefaultsForProvider(params: {
  prisma: PrismaClient;
  provider: string;
  scopeType: ModelDefaultScopeType;
  scopeId: string;
  authorId?: string | null;
}): Promise<void> {
  const { prisma, provider, scopeType, scopeId, authorId } = params;
  const plan = buildSeedPlanForProvider(provider);

  // Strip undefined entries — JSON.stringify would render them as the
  // key not appearing, but Prisma's Json column accepts the object
  // directly. Building a clean object up front keeps the stored shape
  // obvious in the test snapshot.
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(plan)) {
    if (typeof value === "string" && value.length > 0) config[key] = value;
  }
  if (Object.keys(config).length === 0) return;

  // Idempotent at the scope level: if any config is already attached
  // here, leave everything alone. Replacing or merging would step on
  // the user's intentional choices (including their intentional
  // "inherit from parent" via key absence).
  const existing = await prisma.modelDefaultConfigScope.findFirst({
    where: { scopeType, scopeId },
    select: { id: true },
  });
  if (existing) return;

  await prisma.modelDefaultConfig.create({
    data: {
      config,
      authorId: authorId ?? null,
      scopes: {
        create: [{ scopeType, scopeId }],
      },
    },
  });
}
