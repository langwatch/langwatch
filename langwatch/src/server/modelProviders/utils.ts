import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../../env.mjs";
import { DEFAULT_MODEL } from "../../utils/constants";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders.utils";
import { prisma } from "../db";
import type { MaybeStoredModelProvider } from "./registry";

export const getVercelAIModel = async (projectId: string, model?: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const modelProviders = await getProjectModelProviders(projectId);

  const model_ = resolveModel({
    explicit: model,
    projectDefault: project.defaultModel,
    fallback: DEFAULT_MODEL,
    modelProviders,
  });

  const providerKey = model_.split("/")[0] as keyof typeof modelProviders;
  const modelProvider = modelProviders[providerKey];

  if (!modelProvider) {
    throw new Error(
      `Model provider "${providerKey}" is not configured for this project. Go to Settings → Model Providers to add it.`,
    );
  }
  if (!modelProvider.enabled) {
    throw new Error(
      `Model provider "${providerKey}" is configured but disabled. Go to Settings → Model Providers to enable it.`,
    );
  }

  const litellmParams = await prepareLitellmParams({
    model: model_,
    modelProvider,
    projectId,
  });
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  const vercelProvider = createOpenAICompatible({
    name: `${providerKey}`,
    apiKey: litellmParams.api_key,
    baseURL: `${env.LANGWATCH_NLP_SERVICE}/proxy/v1`,
    headers,
  });

  return vercelProvider(model_);
};

function resolveModel({
  explicit,
  projectDefault,
  fallback,
  modelProviders,
}: {
  explicit: string | undefined;
  projectDefault: string | null | undefined;
  fallback: string;
  modelProviders: Record<string, MaybeStoredModelProvider>;
}): string {
  // 1. Explicit model always wins
  if (explicit) return explicit;

  // 2. Project default — only if its provider is configured
  if (projectDefault) {
    const providerKey = projectDefault.split("/")[0] ?? "";
    if (modelProviders[providerKey]?.enabled) return projectDefault;
  }

  // 3. Hardcoded fallback — only if its provider is configured
  const fallbackProvider = fallback.split("/")[0] ?? "";
  if (modelProviders[fallbackProvider]?.enabled) return fallback;

  // 4. Find any enabled provider with a custom model
  for (const [key, provider] of Object.entries(modelProviders)) {
    if (provider.enabled && provider.customModels?.length) {
      return `${key}/${provider.customModels[0]?.modelId ?? ""}`;
    }
  }

  // 5. Nothing available — distinguish "none configured" from "all disabled"
  if (Object.keys(modelProviders).length > 0) {
    throw new Error(
      "All configured model providers are disabled or have no usable models. Go to Settings → Model Providers to enable one or add a model.",
    );
  }

  throw new Error(
    "No model providers configured for this project. Go to Settings → Model Providers to add one.",
  );
}
