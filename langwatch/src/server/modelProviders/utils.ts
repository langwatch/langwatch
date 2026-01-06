import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../../env.mjs";
import { DEFAULT_MODEL } from "../../utils/constants";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders";
import { prisma } from "../db";

export const getVercelAIModel = async (projectId: string, model?: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const model_ = model ?? project.defaultModel ?? DEFAULT_MODEL;

  // Get model providers for the project (includes API keys and configuration)
  // includeKeys defaults to true, so custom API keys from the project will be included
  const modelProviders = await getProjectModelProviders(projectId, true);
  const providerKey = model_.split("/")[0] as string;
  const modelProvider = modelProviders[providerKey];

  if (!modelProvider) {
    throw new Error(
      `Model provider ${providerKey} not found for project. Available providers: ${Object.keys(modelProviders).join(", ")}`,
    );
  }

  if (!modelProvider.enabled) {
    throw new Error(
      `Model provider ${providerKey} is disabled for project. Go to settings to enable it.`,
    );
  }

  // Prepare litellm params which extracts API keys from:
  // 1. Custom keys stored in the project's modelProvider record (if any)
  // 2. Environment variables as fallback
  const litellmParams = await prepareLitellmParams({
    model: model_,
    modelProvider,
    projectId,
  });

  // Verify API key is available
  if (!litellmParams.api_key && modelProvider.provider !== "vertex_ai" && modelProvider.provider !== "bedrock") {
    throw new Error(
      `API key not configured for provider ${providerKey}. Please configure it in project settings.`,
    );
  }

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
