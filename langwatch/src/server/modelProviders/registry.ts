import { z } from "zod";
import type { ModelProvider } from "@prisma/client";
import models from "../../../models.json";

type ModelProviderDefinition = {
  name: string;
  apiKey: string;
  endpointKey: string | undefined;
  keysSchema: z.ZodTypeAny;
  enabledSince?: Date;
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
  return Object.entries(models)
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

function isValidJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch (_) {
    return false;
  }
}
