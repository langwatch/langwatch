import type { ModelProvider } from "@prisma/client";
import { z } from "zod";
import type { CustomModelEntry } from "./customModel.schema";
// @ts-ignore - JSON import
import * as llmModelsRaw from "./llmModels.json";
import type { LLMModelEntry, LLMModelRegistry } from "./llmModels.types";

const llmModels = llmModelsRaw as unknown as LLMModelRegistry;

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
  apiKey: string;
  endpointKey: string | undefined;
  keysSchema: z.ZodTypeAny;
  enabledSince: Date;
  blurb?: string;
  /** Provider-level parameter constraints (e.g., temperature max for Anthropic) */
  parameterConstraints?: ParameterConstraints;
};

export type MaybeStoredModelProvider = Omit<
  ModelProvider,
  | "id"
  | "projectId"
  | "createdAt"
  | "updatedAt"
  | "customModels"
  | "customEmbeddingsModels"
> & {
  id?: string;
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
    apiKey: "CUSTOM_API_KEY",
    endpointKey: "CUSTOM_BASE_URL",
    keysSchema: z.object({
      CUSTOM_API_KEY: z.string().nullable().optional(),
      CUSTOM_BASE_URL: z.string().nullable().optional(),
    }),
    enabledSince: new Date("2023-01-01"),
    blurb:
      "Use this option for LiteLLM proxy, self-hosted vLLM or any other model providers that supports the /chat/completions endpoint.",
  },
  openai: {
    name: "OpenAI",
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
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Either OPENAI_API_KEY or OPENAI_BASE_URL must be provided with a non-empty value",
          });
        }
      }),
    enabledSince: new Date("2023-01-01"),
  },
  anthropic: {
    name: "Anthropic",
    apiKey: "ANTHROPIC_API_KEY",
    endpointKey: "ANTHROPIC_BASE_URL",
    keysSchema: z.object({
      ANTHROPIC_API_KEY: z.string().min(1),
      ANTHROPIC_BASE_URL: z.string().nullable().optional(),
    }),
    enabledSince: new Date("2023-01-01"),
    // Anthropic API limits temperature to 0-1 range
    parameterConstraints: {
      temperature: { min: 0, max: 1 },
    },
  },
  gemini: {
    name: "Gemini",
    apiKey: "GEMINI_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      GEMINI_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  azure: {
    name: "Azure OpenAI",
    apiKey: "AZURE_OPENAI_API_KEY",
    endpointKey: "AZURE_OPENAI_ENDPOINT",
    keysSchema: z
      .object({
        AZURE_OPENAI_API_KEY: z.string().nullable().optional(),
        AZURE_OPENAI_ENDPOINT: z.string().nullable().optional(),
        AZURE_API_GATEWAY_BASE_URL: z.string().nullable().optional(),
        AZURE_API_GATEWAY_VERSION: z.string().nullable().optional(),
      })
      .passthrough(),
    enabledSince: new Date("2023-01-01"),
  },
  bedrock: {
    name: "Bedrock",
    apiKey: "AWS_ACCESS_KEY_ID",
    endpointKey: undefined,
    keysSchema: z.object({
      AWS_ACCESS_KEY_ID: z.string().nullable().optional(),
      AWS_SECRET_ACCESS_KEY: z.string().nullable().optional(),
      AWS_REGION_NAME: z.string().nullable().optional(),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  vertex_ai: {
    name: "Vertex AI",
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
    apiKey: "DEEPSEEK_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      DEEPSEEK_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  xai: {
    name: "xAI",
    apiKey: "XAI_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      XAI_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2024-11-01"),
  },
  cerebras: {
    name: "Cerebras",
    apiKey: "CEREBRAS_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      CEREBRAS_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2024-06-01"),
  },
  groq: {
    name: "Groq",
    apiKey: "GROQ_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      GROQ_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
} satisfies Record<string, ModelProviderDefinition>;

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

  const providerDef = modelProviders[
    provider as keyof typeof modelProviders
  ] as ModelProviderDefinition | undefined;
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
export const allLitellmModels: Record<string, { mode: "chat" | "embedding" }> =
  Object.fromEntries(
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
