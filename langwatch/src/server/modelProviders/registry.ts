import type { ModelProvider } from "@prisma/client";
import { z } from "zod";
// @ts-ignore
import * as llmModelCostsRaw from "./llmModelCosts.json";

const llmModelCosts = llmModelCostsRaw as unknown as Record<
  string,
  { mode?: "chat" | "embedding"; litellm_provider: string }
>;

type ModelProviderDefinition = {
  name: string;
  apiKey: string;
  endpointKey: string | undefined;
  keysSchema: z.ZodTypeAny;
  enabledSince: Date;
  blurb?: string;
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
  models?: string[] | null;
  embeddingsModels?: string[] | null;
  disabledByDefault?: boolean;
  extraHeaders?: { key: string; value: string }[] | null;
};

/** Validates URL format when value is present, allows empty/null/undefined */
const optionalUrlField = () =>
  z
    .string()
    .nullable()
    .optional()
    .refine(
      (val) =>
        !val || val.trim() === "" || z.string().url().safeParse(val).success,
      { message: "Must be a valid URL (e.g., https://api.openai.com/v1)" },
    );

export const getProviderModelOptions = (
  provider: string,
  mode: "chat" | "embedding",
) => {
  return Object.entries(allLitellmModels)
    .filter(([key, _]) => key.split("/")[0] === provider)
    .filter(([_, value]) => value.mode === mode)
    .map(([key, _]) => ({
      value: key.split("/").slice(1).join("/"),
      label: key.split("/").slice(1).join("/"),
    }));
};

export const modelProviders = {
  custom: {
    name: "Custom (OpenAI-compatible)",
    apiKey: "CUSTOM_API_KEY",
    endpointKey: "CUSTOM_BASE_URL",
    keysSchema: z.object({
      CUSTOM_API_KEY: z.string().nullable().optional(),
      CUSTOM_BASE_URL: optionalUrlField(),
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
        OPENAI_BASE_URL: optionalUrlField(),
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
      ANTHROPIC_BASE_URL: optionalUrlField(),
    }),
    enabledSince: new Date("2023-01-01"),
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
        AZURE_OPENAI_ENDPOINT: optionalUrlField(),
        AZURE_API_GATEWAY_BASE_URL: optionalUrlField(),
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

export const allLitellmModels = (() => {
  let models: Record<string, { mode: "chat" | "embedding" }> = {
    ...Object.fromEntries(
      Object.entries(llmModelCosts)
        .filter(
          ([key, value]) =>
            value.litellm_provider in modelProviders &&
            "mode" in value &&
            (value.mode === "chat" || value.mode === "embedding") &&
            // Remove double-slash models like /us/, or /eu/
            (key.match(/\//g)?.length || 0) <= 1 &&
            // Remove openai realtime and old models
            !(
              value.litellm_provider === "openai" &&
              key.match(
                /-realtime|computer-use|audio-preview|gpt-4-|gpt-3\.?5|^ft:|search|^chatgpt/,
              )
            ) &&
            // Remove azure realtime and old models
            !(
              value.litellm_provider === "azure" &&
              key.match(
                /-realtime|computer-use|audio-preview|gpt-4-|gpt-3\.?5|mistral|command-r/,
              )
            ) &&
            // Remove anthropic old models
            !(
              value.litellm_provider === "anthropic" &&
              key.match(/^claude-3-(sonnet|haiku|opus)|claude-2|claude-instant/)
            ) &&
            // Remove gemini old models
            !(
              value.litellm_provider === "gemini" &&
              key.match(
                /gemini-1\.5-|learnlm-|gemma-2|gemini-exp|gemini-pro|-001$/,
              )
            ) &&
            // Remove bedrock region-specific and old models
            !(
              value.litellm_provider === "bedrock" &&
              key.match(
                /^eu\.|^us\.|anthropic\.claude-3-\D|claude-v|claude-instant|llama2|llama3-70b|llama3-8b|llama3-1|titan-text/,
              )
            ) &&
            // Remove groq old models
            !(
              value.litellm_provider === "groq" &&
              key.match(/llama2|llama3-|llama-3\.1|llama-3\.2|gemma-7b/)
            ),
        )
        .map(([key, value]) => {
          return [
            key.includes("/") ? key : value.litellm_provider + "/" + key,
            {
              mode: (value as any).mode as "chat" | "embedding",
            },
          ];
        }),
    ),
  };

  // Remove dated models
  models = Object.fromEntries(
    Object.entries(models).filter(([key, _]) => {
      const match = key.match(
        /(.*?)-(\d{4}-\d{2}-\d{2}|\d{4}|\d{8}|\d{2}-\d{2})$/,
      );
      if (!match) return true;
      const modelName = match[1];
      return (
        modelName &&
        !(modelName in models) &&
        !(`${modelName}-latest` in models)
      );
    }),
  );

  return models;
})();

function isValidJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch (_) {
    return false;
  }
}
