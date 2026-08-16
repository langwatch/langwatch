import { z } from "zod";
import type { ModelProvider } from "~/generated/prisma/client";
import { codexTokenKeysSchema } from "./codexAccount.schema";
import { CODEX_ALLOWED_FEATURE_KEYS } from "./codexRestrictions";
import type { CustomModelEntry } from "./customModel.schema";
import type { LLMModelEntry } from "./llmModels.types";
import { llmModels } from "./loadModelCatalog";

// ============================================================================
// Parameter Constraint Types
// ============================================================================

/**
 * Constraint for a single parameter (e.g., temperature min/max)
 */
export type ParameterConstraint = {
  min?: number;
  max?: number;
};

/**
 * Provider-level parameter constraints
 * Maps parameter names to their constraints
 */
export type ParameterConstraints = Record<string, ParameterConstraint>;

type ModelProviderDefinition = {
  name: string;
  /**
   * Category of provider. "llm" providers offer chat/embedding models and
   * power the LangWatch app features (default model, topic clustering, etc).
   * "safety" providers are non-LLM credential containers for services like
   * Azure Content Safety — they only expose credentials + extra headers
   * and never appear in model selectors or default-model settings.
   */
  type: "llm" | "safety";
  apiKey: string;
  endpointKey: string | undefined;
  keysSchema: z.ZodTypeAny;
  enabledSince: Date;
  blurb?: string;
  /** Provider-level parameter constraints (e.g., temperature max for Anthropic) */
  parameterConstraints?: ParameterConstraints;
  /**
   * Keys that are never required for manual setup. The credential schemas
   * use `.nullable().optional()` to permit env-var fallback, so Zod's
   * `.isOptional()` can't distinguish "truly optional override" from
   * "required but nullable for storage" — this list settles that.
   *
   * It is a floor, not the whole answer: a schema whose refinement accepts
   * one credential in place of another relaxes the remaining fields as the
   * customer fills the form in. See `getRequiredCredentialKeys`.
   */
  optionalKeys?: string[];
  /**
   * How the provider is credentialed. "api-key" (the default) renders the
   * schema's fields as inputs; "oauth-device" replaces them with a
   * sign-in-with-the-provider flow — the customKeys then hold the OAuth
   * token set rather than anything the user typed.
   */
  authFlow?: "api-key" | "oauth-device";
  /**
   * When set, this provider's models may only serve the listed feature keys
   * (plus nothing else): pickers on other surfaces hide them and execution
   * paths reject them. Used by providers whose upstream terms limit usage,
   * e.g. the Codex plan backend is licensed for coding-assistant surfaces
   * only. Absent = unrestricted. See allowedCodexFeatures.ts.
   */
  restrictedToFeatureKeys?: readonly string[];
  /**
   * The provider no longer accepts new rows. The Add menu hides it and
   * `updateModelProvider` refuses to create one — hiding a tile is not
   * enforcement, and the stored population has to be able to reach zero
   * or this entry can never be deleted. Stored rows stay readable,
   * editable, validatable and dispatchable, so no deployment is ever
   * stranded mid-fold.
   *
   * `replacedBy` names the provider that absorbed it
   * (google_agent_platform → gemini), which is what turns the refusal
   * into something the caller can act on.
   */
  deprecated?: { replacedBy: string };
};

export type MaybeStoredModelProvider = Omit<
  ModelProvider,
  | "id"
  | "name"
  | "createdAt"
  | "updatedAt"
  | "customModels"
  | "customEmbeddingsModels"
  // Advanced (gateway) fields land on persisted rows; form-time shapes
  // omit them, so widen the type to make them optional here.
  | "rateLimitRpm"
  | "rateLimitTpm"
  | "rateLimitRpd"
  | "rotationPolicy"
  | "providerConfig"
  | "fallbackPriorityGlobal"
  | "healthStatus"
  | "circuitOpenedAt"
  | "lastHealthCheckAt"
  | "disabledAt"
  // Single-organization tenancy anchor (ADR-021) lands on persisted rows;
  // form-time shapes omit it, so widen to optional here.
  | "organizationId"
> & {
  id?: string;
  organizationId?: string | null;
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  rateLimitRpd?: number | null;
  rotationPolicy?: "MANUAL";
  providerConfig?: unknown;
  fallbackPriorityGlobal?: number | null;
  healthStatus?: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CIRCUIT_OPEN";
  circuitOpenedAt?: Date | null;
  lastHealthCheckAt?: Date | null;
  disabledAt?: Date | null;
  /**
   * Human-readable name (iter 109). Optional in the inbound shape used
   * by form seeding where registry defaults get promoted before a row
   * exists; persisted rows always carry a value. Defaults derive from
   * the humanized provider name with auto-suffixing for collisions.
   */
  name?: string;
  /** Registry model IDs (populated from the model registry, not user-managed) */
  models?: string[] | null;
  /** Registry embedding model IDs (populated from the model registry) */
  embeddingsModels?: string[] | null;
  /** User-defined custom chat models with metadata */
  customModels?: CustomModelEntry[] | null;
  /** User-defined custom embedding models with metadata */
  customEmbeddingsModels?: CustomModelEntry[] | null;
  disabledByDefault?: boolean;
  extraHeaders?: { key: string; value: string }[] | null;
  /**
   * True for pseudo-rows synthesized from the server's process env
   * (no `ModelProvider` row exists). The settings table renders these
   * with a "SYSTEM" scope chip and hides the row's edit affordances,
   * since they're managed via env vars rather than the UI.
   */
  isSystem?: boolean;
  /**
   * Multi-scope grant set (iter 109). Every persisted MP has at least
   * one entry; registry-seeded placeholders for providers that don't
   * have a row yet omit the field. Consumers that need access-control
   * reasoning should read this array rather than the collapsed single-
   * scope pair below.
   */
  scopes?: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  /**
   * Narrowest-scope pair derived from `scopes` for legacy callers that
   * still key by scopeType/scopeId. New code should read `scopes[]`.
   */
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
  /**
   * True when this row's credential cannot serve embedding models, so a
   * picker must not offer them. Derived server-side (see
   * `modelProviders/geminiDoor.ts`) because the answer can depend on the
   * server's own env, which the frontend cannot read, and on the API key,
   * which it must never receive. Only Gemini's Agent Platform door has
   * this shape today.
   */
  embeddingsUnsupported?: boolean;
};

// ============================================================================
// Model Registry Access Functions
// ============================================================================

/**
 * Get all models from the registry
 */
export const getAllModels = (): Record<string, LLMModelEntry> => {
  return llmModels.models;
};

/**
 * Get a specific model by ID
 */
export const getModelById = (modelId: string): LLMModelEntry | undefined => {
  return llmModels.models[modelId];
};

/**
 * Get model metadata for a specific model
 * Returns null if model not found
 */
export const getModelMetadata = (
  modelId: string,
): {
  supportedParameters: string[];
  contextLength: number;
  maxCompletionTokens: number | null;
  defaultParameters: Record<string, unknown> | null;
  pricing: LLMModelEntry["pricing"];
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
} | null => {
  const model = llmModels.models[modelId];
  if (!model) return null;

  return {
    supportedParameters: model.supportedParameters,
    contextLength: model.contextLength,
    maxCompletionTokens: model.maxCompletionTokens,
    defaultParameters: model.defaultParameters,
    pricing: model.pricing,
    supportsImageInput: model.supportsImageInput,
    supportsAudioInput: model.supportsAudioInput,
  };
};

/**
 * Get model options for a specific provider and mode
 */
export const getProviderModelOptions = (
  provider: string,
  mode: "chat" | "embedding",
) => {
  return Object.entries(llmModels.models)
    .filter(([_, model]) => model.provider === provider && model.mode === mode)
    .map(([_, model]) => ({
      value: model.id.split("/").slice(1).join("/"),
      label: model.id.split("/").slice(1).join("/"),
    }));
};

/**
 * Get all models for a provider
 */
export const getModelsForProvider = (provider: string): LLMModelEntry[] => {
  return Object.values(llmModels.models).filter(
    (model) => model.provider === provider,
  );
};

/**
 * Get unique list of all providers in the registry
 */
export const getAllProviders = (): string[] => {
  const providers = new Set(
    Object.values(llmModels.models).map((model) => model.provider),
  );
  return Array.from(providers).sort();
};

/**
 * Get registry metadata (updatedAt, modelCount)
 */
export const getRegistryMetadata = () => ({
  updatedAt: llmModels.updatedAt,
  modelCount: llmModels.modelCount,
});

// ============================================================================
// Provider Definitions
// ============================================================================

export const modelProviders = {
  custom: {
    name: "Custom (OpenAI-compatible)",
    type: "llm",
    apiKey: "CUSTOM_API_KEY",
    endpointKey: "CUSTOM_BASE_URL",
    keysSchema: z.object({
      CUSTOM_API_KEY: z.string().nullable().optional(),
      CUSTOM_BASE_URL: z.string().nullable().optional(),
    }),
    // CUSTOM_BASE_URL is required (the endpoint can't be inferred); the
    // API key is genuinely optional because some proxies (local vLLM,
    // unauthenticated LiteLLM) don't require it.
    optionalKeys: ["CUSTOM_API_KEY"],
    enabledSince: new Date("2023-01-01"),
    blurb:
      "Use this option for LiteLLM proxy, self-hosted vLLM or any other model providers that supports the /chat/completions endpoint.",
  },
  openai_codex: {
    name: "Codex (OpenAI account)",
    type: "llm",
    apiKey: "CODEX_ACCESS_TOKEN",
    endpointKey: undefined,
    keysSchema: codexTokenKeysSchema,
    authFlow: "oauth-device",
    restrictedToFeatureKeys: CODEX_ALLOWED_FEATURE_KEYS,
    enabledSince: new Date("2026-07-20"),
    blurb:
      "Sign in with your OpenAI account and Langy runs on your ChatGPT plan. Serves the coding-assistant surfaces only.",
  },
  openai: {
    name: "OpenAI",
    type: "llm",
    apiKey: "OPENAI_API_KEY",
    endpointKey: "OPENAI_BASE_URL",
    keysSchema: z
      .object({
        OPENAI_API_KEY: z.string().nullable().optional(),
        OPENAI_BASE_URL: z.string().nullable().optional(),
      })
      .superRefine((data, ctx) => {
        if (
          (!data.OPENAI_API_KEY || data.OPENAI_API_KEY.trim() === "") &&
          (!data.OPENAI_BASE_URL || data.OPENAI_BASE_URL.trim() === "")
        ) {
          // Reaches the customer as the drawer's inline error, so it reads
          // as guidance rather than as a schema complaint.
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Add an API key, or a base URL if your endpoint does not need one.",
          });
        }
      }),
    // The base URL is an override (defaults to api.openai.com), so it is
    // never required. The API key is required until a base URL is set: a
    // self-hosted OpenAI-compatible server commonly runs unauthenticated,
    // and the drawer follows the refinement above rather than a second
    // list that could disagree with it.
    optionalKeys: ["OPENAI_BASE_URL"],
    enabledSince: new Date("2023-01-01"),
  },
  anthropic: {
    name: "Anthropic",
    type: "llm",
    apiKey: "ANTHROPIC_API_KEY",
    endpointKey: "ANTHROPIC_BASE_URL",
    keysSchema: z
      .object({
        ANTHROPIC_API_KEY: z.string().nullable().optional(),
        ANTHROPIC_BASE_URL: z.string().nullable().optional(),
      })
      .superRefine((data, ctx) => {
        if (
          (!data.ANTHROPIC_API_KEY || data.ANTHROPIC_API_KEY.trim() === "") &&
          (!data.ANTHROPIC_BASE_URL || data.ANTHROPIC_BASE_URL.trim() === "")
        ) {
          // Reaches the customer as the drawer's inline error, so it reads
          // as guidance rather than as a schema complaint.
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Add an API key, or a base URL if your endpoint does not need one.",
          });
        }
      }),
    // The base URL points at an Anthropic-compatible self-hosted server
    // (vLLM >= 0.24). Such servers commonly run unauthenticated, so the
    // API key may be empty when a base URL is set — mirroring openai
    // above. api.anthropic.com itself always requires the key, and the
    // drawer follows this refinement rather than a second list that could
    // disagree with it.
    optionalKeys: ["ANTHROPIC_BASE_URL"],
    enabledSince: new Date("2023-01-01"),
    // Anthropic API limits temperature to 0-1 range
    parameterConstraints: {
      temperature: { min: 0, max: 1 },
    },
  },
  gemini: {
    name: "Gemini",
    type: "llm",
    apiKey: "GEMINI_API_KEY",
    endpointKey: undefined,
    // One provider, two Google doors. An AI Studio key answers on
    // generativelanguage.googleapis.com; a key minted for Gemini Enterprise
    // Agent Platform is refused there (API_KEY_SERVICE_BLOCKED) and answers
    // on aiplatform.googleapis.com at a path naming the project and
    // location. Same models, same wire shape, same auth header — verified
    // live with one key of each kind. So the door is a property of the
    // credential, not a provider of its own: project + location present
    // means the Agent Platform door, absent means the Gemini API. See
    // specs/model-providers/google-agent-platform.feature.
    keysSchema: z
      .object({
        GEMINI_API_KEY: z.string().min(1),
        // Trimmed at the schema so a whitespace-only value stores as ""
        // and every layer (validation, materialiser, Go header parser)
        // agrees on whether the pair is present — they all test emptiness.
        GEMINI_PROJECT: z.string().trim().nullable().optional(),
        // Both `global` and a region such as `us-central1` resolve; the
        // Agent Platform path requires one either way, so it is asked for
        // rather than guessed.
        GEMINI_LOCATION: z.string().trim().nullable().optional(),
      })
      .superRefine((data, ctx) => {
        // The Agent Platform path needs both or neither: a project without
        // a location (or the reverse) cannot be probed or dispatched, and
        // silently ignoring the lone field would validate a credential
        // through a different door than traffic would later use. The issue
        // lands on the EMPTY side of the pair so the form renders it under
        // the field the customer has to fill — a pathless issue gets
        // re-anchored under the first field (the API key), which reads as
        // the wrong field complaining.
        if (!!data.GEMINI_PROJECT !== !!data.GEMINI_LOCATION) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: data.GEMINI_PROJECT
              ? ["GEMINI_LOCATION"]
              : ["GEMINI_PROJECT"],
            message:
              "Fill in both the project and the location, or leave both empty for an AI Studio key.",
          });
        }
      }),
    optionalKeys: ["GEMINI_PROJECT", "GEMINI_LOCATION"],
    enabledSince: new Date("2023-01-01"),
  },
  // Compatibility for rows stored while Agent Platform was its own
  // provider. Deprecated: hidden from the Add menu, but the rows stay
  // visible, editable, validatable and dispatchable — without this entry,
  // application pods running this version would treat them as an unknown
  // provider and hide them. Converting them into `gemini` rows is a
  // separate, per-deployment data migration; delete this entry (and its
  // validation + materialiser branches) only in a release after that
  // migration has run everywhere.
  google_agent_platform: {
    name: "Google Agent Platform",
    type: "llm",
    apiKey: "GOOGLE_AGENT_PLATFORM_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      GOOGLE_AGENT_PLATFORM_API_KEY: z.string().min(1),
      GOOGLE_AGENT_PLATFORM_PROJECT: z.string().min(1),
      GOOGLE_AGENT_PLATFORM_LOCATION: z.string().min(1),
    }),
    enabledSince: new Date("2026-07-29"),
    deprecated: { replacedBy: "gemini" },
  },
  elevenlabs: {
    name: "ElevenLabs",
    // Audio (TTS + STT through the gateway's /v1/audio routes) plus brokered
    // Conversational AI sessions. Registered like every provider so the key
    // lives in Settings -> Model Providers; the LLM model catalog carries no
    // elevenlabs chat models, so it never shows up in chat model selectors.
    type: "llm",
    apiKey: "ELEVENLABS_API_KEY",
    endpointKey: "ELEVENLABS_BASE_URL",
    keysSchema: z.object({
      ELEVENLABS_API_KEY: z.string().min(1),
      // The workspace post-call webhook secret. A brokered voice
      // conversation reports nothing over its socket: cost and duration
      // arrive on that webhook, and without this secret its signature
      // cannot be verified, so the calls settle as cost-unknown.
      ELEVENLABS_WEBHOOK_SECRET: z.string().nullable().optional(),
      // The regional API host. ElevenLabs publishes residency endpoints, and
      // a session minted against the default host is signed in the wrong
      // region for a customer who chose one.
      ELEVENLABS_BASE_URL: z.string().nullable().optional(),
    }),
    optionalKeys: ["ELEVENLABS_WEBHOOK_SECRET", "ELEVENLABS_BASE_URL"],
    enabledSince: new Date("2026-07-25"),
    blurb:
      "Voice models for lifelike text to speech and accurate transcription.",
  },
  azure: {
    name: "Azure OpenAI",
    type: "llm",
    apiKey: "AZURE_OPENAI_API_KEY",
    endpointKey: "AZURE_OPENAI_ENDPOINT",
    keysSchema: z
      .object({
        AZURE_OPENAI_API_KEY: z.string().nullable().optional(),
        AZURE_OPENAI_ENDPOINT: z.string().nullable().optional(),
        AZURE_OPENAI_API_VERSION: z.string().nullable().optional(),
        AZURE_API_GATEWAY_BASE_URL: z.string().nullable().optional(),
        AZURE_API_GATEWAY_VERSION: z.string().nullable().optional(),
      })
      .passthrough(),
    // Direct-mode and gateway-mode each require their endpoint/base-url +
    // api-key; the useApiGateway toggle in the UI swaps which set is visible.
    // The api-version fields are optional — prepareLitellmParams falls back to
    // a sensible default for each (DEFAULT_AZURE_API_VERSION for direct mode,
    // 2024-05-01-preview for the gateway) when left blank.
    optionalKeys: ["AZURE_OPENAI_API_VERSION", "AZURE_API_GATEWAY_VERSION"],
    enabledSince: new Date("2023-01-01"),
  },
  bedrock: {
    name: "Bedrock",
    type: "llm",
    apiKey: "AWS_ACCESS_KEY_ID",
    endpointKey: undefined,
    keysSchema: z.object({
      AWS_ACCESS_KEY_ID: z.string().nullable().optional(),
      AWS_SECRET_ACCESS_KEY: z.string().nullable().optional(),
      AWS_REGION_NAME: z.string().nullable().optional(),
    }),
    // All three AWS creds are required for manual Bedrock setup; the
    // `.nullable().optional()` on the schema is only to permit env-var
    // fallback in the inbound payload.
    optionalKeys: [],
    enabledSince: new Date("2023-01-01"),
  },
  vertex_ai: {
    name: "Vertex AI",
    type: "llm",
    apiKey: "GOOGLE_APPLICATION_CREDENTIALS",
    endpointKey: undefined,
    keysSchema: z.object({
      GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).refine(isValidJson),
      VERTEXAI_PROJECT: z.string().min(1),
      VERTEXAI_LOCATION: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  deepseek: {
    name: "DeepSeek",
    type: "llm",
    apiKey: "DEEPSEEK_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      DEEPSEEK_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  xai: {
    name: "xAI",
    type: "llm",
    apiKey: "XAI_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      XAI_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2024-11-01"),
  },
  cerebras: {
    name: "Cerebras",
    type: "llm",
    apiKey: "CEREBRAS_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      CEREBRAS_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2024-06-01"),
  },
  groq: {
    name: "Groq",
    type: "llm",
    apiKey: "GROQ_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      GROQ_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  voyage: {
    name: "Voyage AI",
    type: "llm",
    apiKey: "VOYAGE_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      VOYAGE_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2026-05-18"),
  },
  azure_safety: {
    name: "Azure Safety",
    type: "safety",
    apiKey: "AZURE_CONTENT_SAFETY_KEY",
    endpointKey: "AZURE_CONTENT_SAFETY_ENDPOINT",
    keysSchema: z.object({
      AZURE_CONTENT_SAFETY_ENDPOINT: z.string().url(),
      AZURE_CONTENT_SAFETY_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2026-04-10"),
    blurb:
      "Azure Content Safety for content moderation, prompt injection, and jailbreak detection. Your subscription is billed directly by Microsoft.",
  },
} satisfies Record<string, ModelProviderDefinition>;

/**
 * Whether the gateway's chat dispatcher can route to this provider — the ONE
 * predicate behind both the server-side eligibility walk
 * (`gateway/scopeResolver.eligibleModelProvidersForVk`) and the client-side
 * mirror (`components/gateway/eligibleModelProviders.isRoutable`), so the
 * binding picker never offers a provider the dispatch chain would drop.
 *
 * Non-LLM providers (registry type "safety", e.g. azure_safety) hold
 * credentials for evaluators, not chat dispatch; the Go gateway's Bifrost
 * router has no adapter for them, so letting one into a VK chain makes
 * fallback attempts fail with "unsupported provider: azure_safety".
 *
 * This dimension deliberately fails OPEN for ids absent from the registry:
 * they may be newer than this build's registry snapshot, and the
 * materialiser's default branch still knows how to shape their credentials.
 * (The enabled/disabledAt dimension, checked elsewhere, fails closed.)
 */
export function isDispatchableProvider(providerId: string): boolean {
  const entry = modelProviders[providerId as keyof typeof modelProviders];
  return !entry || entry.type === "llm";
}

/**
 * The deprecation on a provider, or undefined when it still accepts new
 * rows.
 *
 * `modelProviders` is a literal typed by `satisfies`, so each entry keeps
 * its own exact shape and `.deprecated` is only reachable on the entries
 * that declare it — reading it off an arbitrary key needs a cast. One
 * narrowing here beats a cast at every caller, and it is the single place
 * that has to change when the flag grows a field.
 */
export const providerDeprecation = (
  provider: string,
): { replacedBy: string } | undefined =>
  (
    modelProviders[provider as keyof typeof modelProviders] as
      | ModelProviderDefinition
      | undefined
  )?.deprecated;

// ============================================================================
// Parameter Constraints
// ============================================================================

/**
 * Get parameter constraints for a model by resolving from its provider.
 * Returns undefined if the provider has no constraints defined.
 *
 * @param modelId - Full model ID (e.g., "anthropic/claude-sonnet-4")
 * @returns Provider's parameter constraints or undefined
 */
export function getParameterConstraints(
  modelId: string,
): ParameterConstraints | undefined {
  const provider = modelId.split("/")[0];
  if (!provider) return undefined;

  const providerDef = modelProviders[provider as keyof typeof modelProviders] as
    | ModelProviderDefinition
    | undefined;
  return providerDef?.parameterConstraints;
}

// ============================================================================
// Backward Compatibility - allLitellmModels
// ============================================================================

/**
 * Known LiteLLM routing variant suffixes that should be filtered from UI selectors.
 * Add new suffixes here as LiteLLM introduces them.
 */
export const KNOWN_VARIANT_SUFFIXES = ["free", "thinking", "extended", "beta"];

/**
 * Checks if a model ID has a variant suffix (e.g., :free, :thinking, :extended).
 * These are LiteLLM routing variants that should be filtered from UI selectors.
 */
export function hasVariantSuffix(modelId: string): boolean {
  const colonIndex = modelId.lastIndexOf(":");
  if (colonIndex === -1) return false;

  const suffix = modelId.substring(colonIndex + 1);

  // Numeric suffixes (like ":0" in Bedrock) are version numbers, not variants
  if (/^\d+$/.test(suffix)) return false;

  // Check for known variant suffixes
  return KNOWN_VARIANT_SUFFIXES.includes(suffix.toLowerCase());
}

/**
 * Legacy export for backward compatibility
 * Maps to the new registry format
 * Excludes models with variant suffixes (:free, :thinking, etc.)
 */
export const allLitellmModels: Record<
  string,
  { mode: "chat" | "embedding" | "audio" }
> = Object.fromEntries(
  Object.entries(llmModels.models)
    .filter(([id]) => !hasVariantSuffix(id))
    .map(([id, model]) => [id, { mode: model.mode }]),
);

// ============================================================================
// Utility Functions
// ============================================================================

function isValidJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch (_) {
    return false;
  }
}
