import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { modelSelectionFrom } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { evaluatorApi } from "./evaluator-api.ts";

/** The project's pickable models for `mode`, and the chosen one among them. */
export function useModelSelection({
  options,
  model,
  mode,
}: {
  options: string[];
  model: string;
  mode: "chat" | "embedding";
}) {
  const { project } = useOrganizationTeamProject();
  const providers = evaluatorApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const { selectOptions } = useMemo(
    () =>
      modelSelectionFrom({ providers: providers.data ?? [], options, mode, featureKey: undefined }),
    [providers.data, options, mode],
  );
  return {
    modelOption: selectOptions.find((option) => option.value === model),
    isLoading: providers.isLoading,
    isEmpty: selectOptions.length === 0,
  };
}
