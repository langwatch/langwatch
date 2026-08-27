import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { getProjectModelProviders } from "./api/routers/modelProviders.utils";
import { prisma } from "./db";

export const getProjectEmbeddingsModel = async (
  modelProvidersService: ModelProviderService,
  projectId: string,
) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  // Resolve the EMBEDDINGS role at the project's cascade. Throws
  // ModelNotConfiguredError if no scope has it set; the caller surfaces
  // that as a sticky toast prompting the user to add an
  // embedding-capable provider.
  const resolved = await modelProvidersService.resolveModelForFeature({
    projectId,
    featureKey: "analytics.topic_clustering_embeddings",
  });
  const embeddingsModel = resolved.model;
  const provider = embeddingsModel.split("/")[0];
  if (!provider) {
    throw new Error("Embeddings provider not set");
  }
  const modelProvider = (
    await getProjectModelProviders(modelProvidersService, project.id)
  )[provider];
  if (!modelProvider) {
    throw new Error(`Embeddings model provider ${provider} not found`);
  }
  if (!modelProvider.enabled) {
    throw new Error(`Embeddings model provider ${provider} is not enabled`);
  }

  return { model: embeddingsModel, modelProvider };
};
