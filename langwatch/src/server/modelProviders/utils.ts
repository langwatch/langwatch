import { createOpenAI } from "@ai-sdk/openai";
import { DEFAULT_MODEL } from "../../utils/constants";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders";
import { prisma } from "../db";
import { env } from "../../env.mjs";

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
      `Model provider ${providerKey} not configured or disabled for project, go to settings to enable it.`
    );
  }

  const litellmParams = prepareLitellmParams(model_, modelProvider);
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ])
  );

  const vercelProvider = createOpenAI({
    apiKey: litellmParams.api_key,
    baseURL: `${env.LANGWATCH_NLP_SERVICE}/proxy/v1`,
    headers,
  });

  return vercelProvider(model_, {
    parallelToolCalls: false,
  });
};
