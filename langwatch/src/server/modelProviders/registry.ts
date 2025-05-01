import { z } from "zod";
import type { ModelProvider } from "@prisma/client";
// @ts-ignore
import * as llmModelCosts from "./llmModelCosts.json";

type ModelProviderDefinition = {
  name: string;
  apiKey: string;
  endpointKey: string | undefined;
  keysSchema: z.ZodTypeAny;
  enabledSince: Date;
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
};

export const getProviderModelOptions = (
  provider: string,
  mode: "chat" | "embedding"
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
  azure: {
    name: "Azure OpenAI",
    apiKey: "AZURE_OPENAI_API_KEY",
    endpointKey: "AZURE_OPENAI_ENDPOINT",
    keysSchema: z.object({
      AZURE_OPENAI_API_KEY: z.string().min(1),
      AZURE_OPENAI_ENDPOINT: z.string().min(1),
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
  bedrock: {
    name: "Bedrock",
    apiKey: "AWS_ACCESS_KEY_ID",
    endpointKey: undefined,
    keysSchema: z.object({
      AWS_ACCESS_KEY_ID: z.string().min(1),
      AWS_SECRET_ACCESS_KEY: z.string().min(1),
      AWS_REGION_NAME: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  atla: {
    name: "Atla",
    apiKey: "ATLA_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      ATLA_API_KEY: z.string().min(1),
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
  groq: {
    name: "Groq",
    apiKey: "GROQ_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      GROQ_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  cloudflare: {
    name: "Cloudflare",
    apiKey: "CLOUDFLARE_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
      CLOUDFLARE_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  custom: {
    name: "Custom",
    apiKey: "CUSTOM_API_KEY",
    endpointKey: "CUSTOM_BASE_URL",
    keysSchema: z.object({
      CUSTOM_API_KEY: z.string().nullable().optional(),
      CUSTOM_BASE_URL: z.string().nullable().optional(),
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
                /-realtime|computer-use|audio-preview|gpt-4-|gpt-3\.?5|^ft:|search|^chatgpt/
              )
            ) &&
            // Remove azure realtime and old models
            !(
              value.litellm_provider === "azure" &&
              key.match(
                /-realtime|computer-use|audio-preview|gpt-4-|gpt-3\.?5|mistral|command-r/
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
                /gemini-1\.5-|learnlm-|gemma-2|gemini-exp|gemini-pro|-001$/
              )
            ) &&
            // Remove bedrock region-specific and old models
            !(
              value.litellm_provider === "bedrock" &&
              key.match(
                /^eu\.|^us\.|anthropic\.claude-3-\D|claude-v|claude-instant|llama2|llama3-70b|llama3-8b|llama3-1|titan-text/
              )
            ) &&
            // Remove groq old models
            !(
              value.litellm_provider === "groq" &&
              key.match(/llama2|llama3-|llama-3\.1|llama-3\.2|gemma-7b/)
            )
        )
        .map(([key, value]) => {
          return [
            key.includes("/") ? key : value.litellm_provider + "/" + key,
            {
              mode: (value as any).mode as "chat" | "embedding",
            },
          ];
        })
    ),
    "atla/atla-selene": { mode: "chat" },
  };

  // Remove dated models
  models = Object.fromEntries(
    Object.entries(models).filter(([key, _]) => {
      const match = key.match(
        /(.*?)-(\d{4}-\d{2}-\d{2}|\d{4}|\d{8}|\d{2}-\d{2})$/
      );
      if (!match) return true;
      const modelName = match[1];
      return (
        modelName &&
        !(modelName in models) &&
        !(`${modelName}-latest` in models)
      );
    })
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
