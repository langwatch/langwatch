import type {
  ModelDefaultScopeType,
  PrismaClient,
} from "~/generated/prisma/client";

import { llmModels } from "./loadModelCatalog";
import { ModelDefaultsRepository } from "./modelDefaults.repository";

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
export function buildSeedPlanForProvider(provider: string): ProviderSeedPlan {
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
 * roles the provider can fulfill. Strictly additive, per KEY:
 *
 *   - If no config is attached to (scopeType, scopeId), one is created
 *     with the seed plan's roles. Default scope: ORGANIZATION so the
 *     entire organization inherits, not just the first project.
 *   - If a config is already attached at the same scope, the roles that
 *     scope does not carry yet are merged into it. A role that already
 *     has a value is never rewritten.
 *
 * Per key rather than per scope, because a scope-level early return let
 * the order the providers were added in decide which roles ever
 * existed: Anthropic seeds DEFAULT and FAST and no EMBEDDINGS, so a
 * later OpenAI add found a config here and did nothing, and every
 * embeddings feature stayed unconfigured on an organization that had
 * two enabled providers.
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

  // Persist through the repository so the org anchor resolution + single-org
  // invariant (ADR-021) live in one place. It mints the KSUIDs, resolves the
  // org for the seeded scope, and hard-fails an unresolvable scope (the column
  // is NOT NULL).
  const repository = new ModelDefaultsRepository(prisma);

  // The merge below reads then writes, so it needs the same organization lock
  // every other default-models write takes first (see `lockForWrite` in
  // modelDefaults.service.ts). Without it a settings save landing between the
  // read and the update would be overwritten by the seed.
  await repository.lockOrganization(
    await repository.organizationIdForScopes([{ scopeType, scopeId }]),
  );

  const configsHere = await repository.findConfigsAtScope(scopeType, scopeId);

  if (configsHere.length === 0) {
    await repository.create({
      config,
      authorId: authorId ?? null,
      scopes: [{ scopeType, scopeId }],
    });
    return;
  }

  // A role counts as set when ANY config at this scope carries it, so the
  // merge cannot duplicate a value the scope already resolves.
  const rolesAlreadyHere = new Set(
    configsHere.flatMap((c) =>
      Object.entries((c.config ?? {}) as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.length > 0)
        .map(([key]) => key),
    ),
  );
  const missing = Object.fromEntries(
    Object.entries(config).filter(([key]) => !rolesAlreadyHere.has(key)),
  );
  if (Object.keys(missing).length === 0) return;

  // Newest config first (findConfigsAtScope sorts by createdAt DESC), which is
  // the row the settings page's own upsert path writes to.
  const target = configsHere[0]!;
  await repository.updateConfigPayload({
    id: target.id,
    data: {
      config: {
        ...((target.config ?? {}) as Record<string, string>),
        ...missing,
      },
    },
  });
}
