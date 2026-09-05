/**
 * Version token for GET /api/internal/gateway/config/:vk_id: VirtualKey.revision covers the key; a provider digest over the materialiser's own resolver covers the dispatch chain the revision never reaches. Moves on any write, even one bypassing the service; budgets/cache/guardrails/spend excluded by decision.
 */
import { createHash } from "node:crypto";
import type { ModelProvider, PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayModelProviderCredentialsPort } from "../ports/gateway-model-provider-credentials.port";
import { llmModels, toLegacyCompatibleCustomModels } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { GatewayConfigAssemblyPort } from "../ports/gateway-config-assembly.port";
import type { VirtualKeyWithScopes } from "../ports/gateway-virtual-key.port";
import { GatewayScopeResolutionService } from "../services/gateway-scope-resolution.service";

const logger = createLogger("langwatch:gateway:config-assembly");

/** The reserved names a routing policy may give a meaning to. */
export const MODEL_TIERS = ["complex", "reasoning", "fast"] as const;

const HOSTED_CATALOG_PREFIXES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  deepseek: "deepseek",
  xai: "xai",
  voyage: "voyageai",
};

const hostedCatalogByProvider = buildHostedCatalog();

function buildHostedCatalog(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [providerKey, prefix] of Object.entries(HOSTED_CATALOG_PREFIXES)) {
    const marker = `${prefix}/`;
    out[providerKey] = Object.keys(llmModels.models)
      .filter((id) => id.startsWith(marker))
      .map((id) => id.slice(marker.length))
      .filter((id) => id.length > 0);
  }
  return out;
}

export class GatewayConfigAssemblyAdapter extends GatewayConfigAssemblyPort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(input: { prisma: PrismaClient }): GatewayConfigAssemblyAdapter {
    return new GatewayConfigAssemblyAdapter(input.prisma);
  }

  async versionToken(virtualKey: VirtualKeyWithScopes): Promise<string> {
    const providers = await GatewayScopeResolutionService.create(
      this.prisma,
    ).eligibleModelProvidersForVk(virtualKey);

    // Order is part of the answer: `providers[]` is the fallback chain, so two
    // identical sets in a different order are two different bundles. The array
    // comes back in dispatch order, and it is digested as it comes.
    const digest = createHash("sha256")
      .update(
        JSON.stringify(providers, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      )
      .digest("hex")
      .slice(0, 16);

    return `${virtualKey.revision}.${digest}`;
  }

  /**
   * Reserved-tier fallthrough only — extending it to unrecognized models would silently resolve a typo instead of rejecting it. A tier with no explicit target and no default model stays an unknown name.
   */
  withTierFallthrough({
    aliases,
    defaultModel,
  }: {
    aliases: Record<string, string>;
    defaultModel: string | null;
  }): Record<string, string> {
    if (!defaultModel) return aliases;
    const withTiers = { ...aliases };
    for (const tier of MODEL_TIERS) {
      if (!withTiers[tier]) withTiers[tier] = defaultModel;
    }
    return withTiers;
  }

  declaredModelsForProvider(mp: {
    provider: string;
    customModels: unknown;
    customEmbeddingsModels: unknown;
  }): string[] | undefined {
    const declared = new Set<string>();

    const chat = toLegacyCompatibleCustomModels(mp.customModels, "chat");
    const embeddings = toLegacyCompatibleCustomModels(mp.customEmbeddingsModels, "embedding");
    for (const entry of [...chat.entries, ...embeddings.entries]) {
      if (entry.modelId) declared.add(entry.modelId);
    }
    const rejected = [...chat.rejected, ...embeddings.rejected];
    if (rejected.length > 0) {
      logger.warn(
        { provider: mp.provider, rejected: rejected.map((entry) => entry.name) },
        "dropped unroutable custom model entries that failed the strict parse",
      );
    }
    for (const id of hostedCatalogByProvider[mp.provider] ?? []) {
      declared.add(id);
    }

    if (declared.size === 0) return void 0;
    return [...declared].sort();
  }

  buildCredentials(
    mp: ModelProvider,
    credentials: GatewayModelProviderCredentialsPort,
  ): Record<string, unknown> {
    const provider = mp.provider;
    const customKeys = credentials.readCustomKeys(mp.customKeys);
    const pick = (k: string): string =>
      typeof customKeys[k] === "string" ? (customKeys[k] as string) : "";

    switch (provider) {
      case "azure": {
        return {
          api_key: pick("AZURE_OPENAI_API_KEY") || pick("api-key"),
          endpoint: pick("AZURE_OPENAI_ENDPOINT") || pick("AZURE_API_GATEWAY_BASE_URL"),
          api_version: pick("AZURE_OPENAI_API_VERSION") || pick("AZURE_API_GATEWAY_VERSION"),
        };
      }
      case "bedrock": {
        return {
          access_key: pick("AWS_ACCESS_KEY_ID"),
          secret_key: pick("AWS_SECRET_ACCESS_KEY"),
          session_token: pick("AWS_SESSION_TOKEN"),
          region: pick("AWS_REGION_NAME") || pick("AWS_REGION"),
        };
      }
      case "vertex_ai":
      case "vertex": {
        return {
          project_id: pick("VERTEXAI_PROJECT") || pick("GOOGLE_PROJECT_ID"),
          project_number: pick("VERTEXAI_PROJECT_NUMBER"),
          region: pick("VERTEXAI_LOCATION") || pick("GOOGLE_REGION"),
          auth_credentials:
            pick("GOOGLE_APPLICATION_CREDENTIALS") || pick("VERTEXAI_SERVICE_ACCOUNT_JSON"),
        };
      }
      case "openai_codex": {
        // OAuth session, not an API key: the gateway sends the access token as
        // the bearer and the ChatGPT account id as a header, and calls back to
        // the control plane (by row id) to refresh a 401'd token once. See
        // services/aigateway codex dispatch + /api/gateway/internal codex
        // refresh route.
        return {
          access_token: pick("CODEX_ACCESS_TOKEN"),
          account_id: pick("CODEX_ACCOUNT_ID"),
          provider_row_id: mp.id,
        };
      }
      case "anthropic":
        return { api_key: pick("ANTHROPIC_API_KEY") };
      case "gemini":
      case "google_gemini":
        return geminiCredentials(pick);
      // Fold-window compatibility: rows stored while Agent Platform was its
      // own provider carry the retired field names. Same wire shape as a
      // gemini credential naming the Agent Platform door; goes with the
      // deprecated registry entry and is deleted after the migration runs.
      case "google_agent_platform":
        return {
          api_key: pick("GOOGLE_AGENT_PLATFORM_API_KEY"),
          project_id: pick("GOOGLE_AGENT_PLATFORM_PROJECT").trim(),
          region: pick("GOOGLE_AGENT_PLATFORM_LOCATION").trim(),
        };
      case "openai":
        return { api_key: pick("OPENAI_API_KEY") };
      case "deepseek":
        return { api_key: pick("DEEPSEEK_API_KEY") };
      case "xai":
        return { api_key: pick("XAI_API_KEY") };
      case "cerebras":
        return { api_key: pick("CEREBRAS_API_KEY") };
      case "groq":
        return { api_key: pick("GROQ_API_KEY") };
      case "cloudflare":
        return { api_key: pick("CLOUDFLARE_API_KEY") };
      default: {
        const apiKey = Object.entries(customKeys).find(([k]) => k.endsWith("_API_KEY"))?.[1];

        return { api_key: typeof apiKey === "string" ? apiKey : "" };
      }
    }
  }
}

// Maps ModelProvider.customKeys (UPPER_SNAKE_CASE, from the LiteLLM
// integration) to the Go gateway's per-provider credential shape — see
// services/aigateway/internal/dispatch/account.go #pcToBifrostKey. A
// credential with project+location routes to Agent Platform; a bare key
// goes to the Gemini API. Exported for tests: the one place these shapes are built.
function geminiCredentials(pick: (k: string) => string): Record<string, unknown> {
  // Trimmed here as well as at the schema: rows stored before the schema
  // trimmed could carry whitespace, and a whitespace-only "pair" must not
  // pick the Agent Platform door.
  const project = pick("GEMINI_PROJECT").trim();
  const location = pick("GEMINI_LOCATION").trim();

  return {
    api_key: pick("GEMINI_API_KEY") || pick("GOOGLE_API_KEY"),
    ...(project && location
      ? {
          project_id: project,
          // `region`, not `location`: buildProviderSlot looks up exactly
          // that key (the convention every other regional provider's
          // credentials follow). Using Google's own term `location` here
          // would silently leave this credential without a slot-level region.
          region: location,
        }
      : {}),
  };
}
