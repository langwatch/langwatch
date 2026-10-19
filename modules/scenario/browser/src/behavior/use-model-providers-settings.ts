import { hasEnabledModelProvider } from "@langwatch/model-provider-contract";

import { api } from "./scenario-api.ts";

/** The project's model providers, and whether any is on; assumed on until the read lands. */
export function useModelProvidersSettings({ projectId }: { projectId: string | undefined }) {
  const query = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const providers = query.data;
  const hasEnabledProviders = query.isLoading || !providers || hasEnabledModelProvider(providers);

  return { providers, hasEnabledProviders };
}
