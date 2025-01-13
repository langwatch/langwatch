import { prisma } from "./db";
import { getProjectModelProviders } from "./api/routers/modelProviders";
import { DEFAULT_EMBEDDINGS_MODEL } from "../utils/constants";

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
