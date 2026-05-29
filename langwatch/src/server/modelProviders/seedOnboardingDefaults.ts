import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";

import { resolveOrganizationForScope } from "../scopes/resolveOrganizationForScope";
import { llmModels } from "./loadModelCatalog";

interface RegistryEntry {
  id: string;
  provider: string;
  mode: "chat" | "embedding";
}

const REGISTRY = (
  llmModels as unknown as { models: Record<string, RegistryEntry> }
).models;

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
 * are skipped (a chat-only provider seeds DEFAULT + FAST but not
 * EMBEDDINGS), which means the role inherits from a higher scope or
 * resolves to ModelNotConfiguredError when nothing covers it.
 */
export function buildSeedPlanForProvider(
  provider: string,
): ProviderSeedPlan {
  // openai/anthropic/gemini get the `{provider}/latest` and
  // `{provider}/latest-mini` aliases so the seed never pins a customer
  // to a specific model version. The resolver expands them at read
  // time, so when a newer flagship lands in the catalog every seeded
  // org picks it up automatically without a config rewrite. Other
  // providers (azure/bedrock/xai/voyage/etc.) keep their specific-id
  // seed paths because they don't have alias support yet.
  if (provider === "openai") {
    return {
      DEFAULT: "openai/latest",
      FAST: "openai/latest-mini",
      EMBEDDINGS: pickLatestEmbedding("openai"),
    };
  }
  if (provider === "anthropic") {
    return {
      DEFAULT: "anthropic/latest",
      FAST: "anthropic/latest-mini",
      // Anthropic ships no embeddings model.
    };
  }
  if (provider === "gemini") {
    return {
      DEFAULT: "gemini/latest",
      FAST: "gemini/latest-mini",
      EMBEDDINGS: pickLatestEmbedding("gemini"),
    };
  }
  if (provider === "voyage") {
    // Voyage is embedding-only. The seed plan populates only
    // EMBEDDINGS so adding Voyage at a scope contributes its
    // embedding model without injecting opinions about DEFAULT or
    // FAST. Chat / fast roles still resolve through whichever other
    // providers the scope has configured.
    return { EMBEDDINGS: pickLatestEmbedding("voyage") };
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
 *     with the seed plan's roles. Default scope: ORGANIZATION so the
 *     entire organization inherits, not just the first project.
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

  // Single-organization anchor (ADR-021): resolve the org the seeded scope
  // belongs to so the row is tenancy-anchored from creation. The column is
  // NOT NULL, so an unresolvable scope is a hard error.
  const organizationId = await resolveOrganizationForScope(prisma, {
    scopeType,
    scopeId,
  });
  if (!organizationId) {
    throw new Error(
      `Cannot seed onboarding defaults: scope ${scopeType}:${scopeId} does not resolve to an organization`,
    );
  }

  await prisma.modelDefaultConfig.create({
    data: {
      config,
      authorId: authorId ?? null,
      organizationId,
      scopes: {
        create: [{ scopeType, scopeId }],
      },
    },
  });
}
