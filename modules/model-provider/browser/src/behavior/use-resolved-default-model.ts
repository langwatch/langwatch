import { modelProviderApi } from "./model-provider-api.ts";

/** The model a feature key resolves to for the project, by cascade; `data` is null when none is set. */
export function useResolvedDefaultModel({
  projectId,
  featureKey,
  enabled = true,
}: {
  projectId: string | undefined;
  featureKey: string;
  enabled?: boolean;
}) {
  return modelProviderApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey },
    { enabled: enabled && !!projectId },
  );
}
