import { OpenAI } from "openai";
import { env } from "../env.mjs";
import { prisma } from "./db";
import { getProjectModelProviders } from "./api/routers/modelProviders";

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

export const getOpenAIEmbeddings = async (text: string, projectId: string) => {
  const { model } = await getProjectEmbeddingsModel(projectId);
  if (!model.startsWith("openai/")) {
    throw new Error("Only OpenAI models are supported for embeddings for now");
  }

  if (!env.OPENAI_API_KEY) {
    console.warn(
      "⚠️  WARNING: OPENAI_API_KEY is not set, embeddings will not be generated for tracing, limiting semantic search and topic clustering. Please set OPENAI_API_KEY for it to work properly"
    );
    return undefined;
  }
  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY ?? "bogus",
  });

  const response = await openai.embeddings.create({
    model: model.replace("openai/", ""),
    input: text.slice(0, 8192 * 1.5),
  });

  const embeddings = response.data[0]?.embedding;
  return embeddings ? { model, embeddings } : undefined;
};
