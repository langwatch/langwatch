import { api } from "../utils/api";

export function useModelProvidersSettings(params: {
  projectId: string | undefined;
}) {
  const projectId = params.projectId ?? "";

  const modelProviders = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );

  return {
    providers: modelProviders.data,
    isLoading: modelProviders.isLoading,
    refetch: modelProviders.refetch,
  } as const;
}
