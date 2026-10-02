import { api, type RouterInputs } from "../scenario-api.ts";

type ModelFeatureKey = RouterInputs["modelProvider"]["getResolvedDefault"]["featureKey"];

/** The model the cascade resolves for one scenario feature in this project. */
export function useResolvedDefaultModel({
  projectId,
  featureKey,
}: {
  projectId: string | undefined;
  featureKey: ModelFeatureKey;
}) {
  return api.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey },
    { enabled: !!projectId },
  );
}

/** Every provider the project has, enabled or not, as the model pickers read them. */
export function useProjectModelProviders({ projectId }: { projectId: string | undefined }) {
  return api.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}
