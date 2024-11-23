import { prisma } from "./db";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "./api/routers/modelProviders";
import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embed } from "ai";
import { OPENAI_EMBEDDING_DIMENSION } from "./elasticsearch";

export const DEFAULT_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";

export const getProjectEmbeddingsModel = async (projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const embeddingsModel = project.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL;
  if (!embeddingsModel) {
    throw new Error("Embeddings model not set");
  }
  const provider = embeddingsModel.split("/")[0];
  if (!provider) {
    throw new Error("Embeddings provider not set");
  }
  const modelProvider = (await getProjectModelProviders(project.id))[provider];
  if (!modelProvider) {
    throw new Error(`Embeddings model provider ${provider} not found`);
  }
  if (!modelProvider.enabled) {
    throw new Error(`Embeddings model provider ${provider} is not enabled`);
  }

  return { model: embeddingsModel, modelProvider };
};

export const getOpenAIEmbeddings = async (
  text: string,
  projectId: string
): Promise<{ model: string; embeddings: number[] } | undefined> => {
  const { model, modelProvider } = await getProjectEmbeddingsModel(projectId);
  if (
    !model.startsWith("openai/") &&
    !model.startsWith("azure/") &&
    !model.startsWith("gemini/")
  ) {
    throw new Error(
      "Only OpenAI or Azure models are supported for embeddings for now"
    );
  }

  const [provider, modelName] = model.split("/");

  if (!modelName) {
    throw new Error(`Embeddings model name not found: ${model}`);
  }

  if (!modelProvider.enabled) {
    console.warn(
      `⚠️  WARNING: Embeddings model provider ${provider} is disabled, embeddings will not be generated for the trace`
    );
    return undefined;
  }

  const params = prepareLitellmParams(model, modelProvider);

  if (!params.api_key && !params.api_base) {
    console.warn(
      `⚠️  WARNING: API key for ${provider} is not set, embeddings will not be generated for the trace`
    );
    return undefined;
  }

  const vercelAIModel =
    provider === "openai"
      ? createOpenAI({
          apiKey: params.api_key,
          baseURL: params.api_base,
        }).textEmbeddingModel(modelName, {
          dimensions: OPENAI_EMBEDDING_DIMENSION,
        })
      : provider === "azure"
      ? createAzure({
          apiKey: params.api_key,
          baseURL: params.api_base?.includes("/deployments")
            ? params.api_base
            : ((params.api_base ?? "") + "/openai/deployments").replace(
                "//",
                "/"
              ),
        }).textEmbeddingModel(modelName, {
          dimensions: OPENAI_EMBEDDING_DIMENSION,
        })
      : provider === "gemini"
      ? createGoogleGenerativeAI({
          apiKey: params.api_key,
          baseURL: params.api_base,
        }).textEmbeddingModel(modelName, {
          outputDimensionality: OPENAI_EMBEDDING_DIMENSION,
        })
      : undefined;

  if (!vercelAIModel) {
    throw new Error(`Embeddings model not found: ${model}`);
  }

  const { embedding } = await embed({
    model: vercelAIModel,
    value: text.slice(0, 8192 * 1.5),
  });

  return { model, embeddings: normalizeEmbeddingDimensions(embedding) };
};

const normalizeEmbeddingDimensions = (
  embedding: number[],
  targetDim: number = OPENAI_EMBEDDING_DIMENSION
): number[] => {
  if (embedding.length === targetDim) {
    return embedding;
  }

  if (embedding.length < targetDim) {
    return [...embedding, ...new Array(targetDim - embedding.length).fill(0)];
  }

  return embedding.slice(0, targetDim);
};
