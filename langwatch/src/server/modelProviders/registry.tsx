import { z } from "zod";
import { OpenAI } from "../../components/icons/OpenAI";
import { Azure } from "../../components/icons/Azure";
import { Anthropic } from "../../components/icons/Anthropic";
import { Groq } from "../../components/icons/Groq";
import type { ModelProvider } from "@prisma/client";

type ModelProviderDefinition = {
  name: string;
  icon: React.ReactNode;
  keys: z.AnyZodObject;
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
    keys: z.object({
      OPENAI_API_KEY: z.string().min(1),
      OPENAI_BASE_URL: z.string().nullable().optional(),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  azure: {
    name: "Azure OpenAI",
    icon: <Azure />,
    keys: z.object({
      AZURE_OPENAI_API_KEY: z.string().min(1),
      AZURE_OPENAI_ENDPOINT: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  anthropic: {
    name: "Anthropic",
    icon: <Anthropic />,
    keys: z.object({
      ANTHROPIC_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
  groq: {
    name: "Groq",
    icon: <Groq />,
    keys: z.object({
      GROQ_API_KEY: z.string().min(1),
    }),
    enabledSince: new Date("2023-01-01"),
  },
} satisfies Record<string, ModelProviderDefinition>;
