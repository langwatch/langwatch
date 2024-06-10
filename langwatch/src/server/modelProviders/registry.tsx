import { z } from "zod";
import { OpenAI } from "../../components/icons/OpenAI";
import { Azure } from "../../components/icons/Azure";
import { Anthropic } from "../../components/icons/Anthropic";
import { Groq } from "../../components/icons/Groq";
import type { ModelProvider } from "@prisma/client";
import { Google } from "../../components/icons/Google";

type ModelProviderDefinition = {
  name: string;
  icon: React.ReactNode;
  apiKey: string;
  endpointKey: string | undefined;
  keysSchema: z.AnyZodObject;
  enabledSince?: Date;
};

export type MaybeStoredModelProvider = Omit<
  ModelProvider,
  "id" | "projectId" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export const modelProviders = {
  openai: {
    name: "OpenAI",
    icon: <OpenAI />,
    apiKey: "OPENAI_API_KEY",
    endpointKey: "OPENAI_BASE_URL",
    keysSchema: z.object({
      OPENAI_API_KEY: z.string().min(1),
      OPENAI_BASE_URL: z.string().nullable().optional(),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  azure: {
    name: "Azure OpenAI",
    icon: <Azure />,
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
    icon: <Anthropic />,
    apiKey: "ANTHROPIC_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      ANTHROPIC_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  groq: {
    name: "Groq",
    icon: <Groq />,
    apiKey: "GROQ_API_KEY",
    endpointKey: undefined,
    keysSchema: z.object({
      GROQ_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  vertex_ai: {
    name: "Vertex AI",
    icon: <Google />,
    apiKey: "GOOGLE_APPLICATION_CREDENTIALS",
    endpointKey: undefined,
    keysSchema: z.object({
      GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).refine(isValidJson),
      VERTEXAI_PROJECT: z.string().min(1),
      VERTEXAI_LOCATION: z.string().min(1),
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
