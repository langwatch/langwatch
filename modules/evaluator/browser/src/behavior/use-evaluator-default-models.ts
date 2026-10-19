import { evaluatorApi } from "./evaluator-api.ts";

/** The cascade-resolved chat and embeddings models a new evaluator starts with. */
export function useEvaluatorDefaultModels({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  const isEnabled = enabled && !!projectId;
  const resolvedDefaultModel = evaluatorApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey: "prompt.create_default" },
    { enabled: isEnabled },
  );
  const resolvedDefaultEmbeddings = evaluatorApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey: "analytics.topic_clustering_embeddings" },
    { enabled: isEnabled },
  );
  return { resolvedDefaultModel, resolvedDefaultEmbeddings };
}
