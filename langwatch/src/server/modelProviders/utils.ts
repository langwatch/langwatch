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

  const providerKey = model_.split("/")[0] as keyof typeof modelProviders;
  const modelProviders = await getProjectModelProviders(projectId);
  const modelProvider = modelProviders[providerKey];

  if (!modelProvider || !modelProvider.enabled) {
    throw new Error(
      `Model provider ${providerKey} not configured or disabled for project, go to settings to enable it.`,
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
