import { z } from "zod";
import { CODEX_ALLOWED_FEATURE_KEYS } from "./catalog/codex-restrictions";
import { codexTokenKeysSchema } from "./codex-account";
import type { CustomModelEntry } from "./custom-model";
import type { ModelProviderScope } from "./model-provider";

export type ParameterConstraint = {
  min?: number;
  max?: number;
};

export type ParameterConstraints = Record<string, ParameterConstraint>;

export type ModelProviderDefinition = {
  name: string;
  type: "llm" | "safety";
  apiKey: string;
  endpointKey?: string;
  keysSchema: z.ZodType;
  enabledSince: Date;
  blurb?: string;
  parameterConstraints?: ParameterConstraints;
  optionalKeys?: string[];
  authFlow?: "api-key" | "oauth-device";
  restrictedToFeatureKeys?: readonly string[];
  deprecated?: { replacedBy: string };
};

/** The portable value rendered by the Model Provider settings editor. */
export type ModelProviderEditorValue = {
  id?: string;
  organizationId?: string | null;
  provider: string;
  name?: string;
  routingHandle?: string | null;
  enabled: boolean;
  customKeys?: Record<string, unknown> | null;
  extraHeaders?: Array<{ key: string; value: string }> | null;
  customModels?: CustomModelEntry[] | null;
  customEmbeddingsModels?: CustomModelEntry[] | null;
  deploymentMapping?: Record<string, string> | null;
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
  models?: string[] | null;
  embeddingsModels?: string[] | null;
  disabledByDefault?: boolean;
  isSystem?: boolean;
  embeddingsUnsupported?: boolean;
  scopes?: ModelProviderScope[];
  scopeType?: ModelProviderScope["scopeType"];
  scopeId?: string;
};

export const ELEVENLABS_HOST_SUFFIX = "elevenlabs.io";

export function isElevenLabsHost(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value.trim() === "") {
    return true;
  }

  const match = /^https:\/\/([^/?#:]+)(?::\d+)?(?:[/?#]|$)/i.exec(value.trim());
  const host = match?.[1]?.toLowerCase();
  if (!host) {
    return false;
  }

  return host === ELEVENLABS_HOST_SUFFIX || host.endsWith(`.${ELEVENLABS_HOST_SUFFIX}`);
}

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
    optionalKeys: ["CUSTOM_API_KEY"],
    enabledSince: new Date("2023-01-01"),
    blurb:
      "Use this option for LiteLLM proxy, self-hosted vLLM or any other model providers that supports the /chat/completions endpoint.",
  },
  openai_codex: {
    name: "Codex (OpenAI account)",
    type: "llm",
    apiKey: "CODEX_ACCESS_TOKEN",
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
      .superRefine((data, context) => {
        const hasApiKey = Boolean(data.OPENAI_API_KEY?.trim());
        const hasBaseUrl = Boolean(data.OPENAI_BASE_URL?.trim());
        if (!hasApiKey && !hasBaseUrl) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Add an API key, or a base URL if your endpoint does not need one.",
          });
        }
      }),
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
      .superRefine((data, context) => {
        const hasApiKey = Boolean(data.ANTHROPIC_API_KEY?.trim());
        const hasBaseUrl = Boolean(data.ANTHROPIC_BASE_URL?.trim());
        if (!hasApiKey && !hasBaseUrl) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Add an API key, or a base URL if your endpoint does not need one.",
          });
        }
      }),
    optionalKeys: ["ANTHROPIC_BASE_URL"],
    enabledSince: new Date("2023-01-01"),
    parameterConstraints: { temperature: { min: 0, max: 1 } },
  },
  gemini: {
    name: "Gemini",
    type: "llm",
    apiKey: "GEMINI_API_KEY",
    keysSchema: z
      .object({
        GEMINI_API_KEY: z.string().min(1),
        GEMINI_PROJECT: z.string().trim().nullable().optional(),
        GEMINI_LOCATION: z.string().trim().nullable().optional(),
      })
      .superRefine((data, context) => {
        if (Boolean(data.GEMINI_PROJECT) === Boolean(data.GEMINI_LOCATION)) {
          return;
        }

        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: data.GEMINI_PROJECT ? ["GEMINI_LOCATION"] : ["GEMINI_PROJECT"],
          message:
            "Fill in both the project and the location, or leave both empty for an AI Studio key.",
        });
      }),
    optionalKeys: ["GEMINI_PROJECT", "GEMINI_LOCATION"],
    enabledSince: new Date("2023-01-01"),
  },
  google_agent_platform: {
    name: "Google Agent Platform",
    type: "llm",
    apiKey: "GOOGLE_AGENT_PLATFORM_API_KEY",
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
    type: "llm",
    apiKey: "ELEVENLABS_API_KEY",
    endpointKey: "ELEVENLABS_BASE_URL",
    keysSchema: z.object({
      ELEVENLABS_API_KEY: z.string().min(1),
      ELEVENLABS_WEBHOOK_SECRET: z.string().nullable().optional(),
      ELEVENLABS_BASE_URL: z.string().nullable().optional().refine(isElevenLabsHost, {
        message:
          "must be an https URL on elevenlabs.io, for example https://api.elevenlabs.io or a residency host such as https://api.eu.residency.elevenlabs.io",
      }),
    }),
    optionalKeys: ["ELEVENLABS_WEBHOOK_SECRET", "ELEVENLABS_BASE_URL"],
    enabledSince: new Date("2026-07-25"),
    blurb: "Voice models for lifelike text to speech and accurate transcription.",
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
    optionalKeys: ["AZURE_OPENAI_API_VERSION", "AZURE_API_GATEWAY_VERSION"],
    enabledSince: new Date("2023-01-01"),
  },
  bedrock: {
    name: "Bedrock",
    type: "llm",
    apiKey: "AWS_ACCESS_KEY_ID",
    keysSchema: z.object({
      AWS_ACCESS_KEY_ID: z.string().nullable().optional(),
      AWS_SECRET_ACCESS_KEY: z.string().nullable().optional(),
      AWS_REGION_NAME: z.string().nullable().optional(),
    }),
    optionalKeys: [],
    enabledSince: new Date("2023-01-01"),
  },
  vertex_ai: {
    name: "Vertex AI",
    type: "llm",
    apiKey: "GOOGLE_APPLICATION_CREDENTIALS",
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
    keysSchema: z.object({ DEEPSEEK_API_KEY: z.string().min(1) }),
    enabledSince: new Date("2023-01-01"),
  },
  xai: {
    name: "xAI",
    type: "llm",
    apiKey: "XAI_API_KEY",
    keysSchema: z.object({ XAI_API_KEY: z.string().min(1) }),
    enabledSince: new Date("2024-11-01"),
  },
  cerebras: {
    name: "Cerebras",
    type: "llm",
    apiKey: "CEREBRAS_API_KEY",
    keysSchema: z.object({ CEREBRAS_API_KEY: z.string().min(1) }),
    enabledSince: new Date("2024-06-01"),
  },
  groq: {
    name: "Groq",
    type: "llm",
    apiKey: "GROQ_API_KEY",
    keysSchema: z.object({ GROQ_API_KEY: z.string().min(1) }),
    enabledSince: new Date("2023-01-01"),
  },
  voyage: {
    name: "Voyage AI",
    type: "llm",
    apiKey: "VOYAGE_API_KEY",
    keysSchema: z.object({ VOYAGE_API_KEY: z.string().min(1) }),
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

export function tryGetModelProviderDefinition(
  provider: string,
): ModelProviderDefinition | null {
  const registry: Record<string, ModelProviderDefinition> = modelProviders;
  return registry[provider] ?? null;
}

export function isDispatchableProvider(providerId: string): boolean {
  const definition = modelProviders[providerId as keyof typeof modelProviders];
  return !definition || definition.type === "llm";
}

export function providerDeprecation(
  provider: string,
): { replacedBy: string } | undefined {
  return (
    modelProviders[provider as keyof typeof modelProviders] as
      | ModelProviderDefinition
      | undefined
  )?.deprecated;
}

export function getParameterConstraints(
  modelId: string,
): ParameterConstraints | undefined {
  const provider = modelId.split("/")[0];
  if (!provider) {
    return undefined;
  }

  const definition = modelProviders[provider as keyof typeof modelProviders] as
    | ModelProviderDefinition
    | undefined;
  return definition?.parameterConstraints;
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
