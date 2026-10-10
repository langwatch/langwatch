import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { type BuiltInModel, modelSelectionFrom } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { evaluatorApi } from "./evaluator-api.ts";

const NO_BUILT_IN_MODELS: readonly BuiltInModel[] = [];

/** The project's pickable models for `mode`, and the chosen one among them. */
export function useModelSelection({
  options,
  model,
  mode,
  builtInModels = NO_BUILT_IN_MODELS,
}: {
  options: string[];
  model: string;
  mode: "chat" | "embedding";
  /** Models LangWatch serves itself, pickable with no provider configured. */
  builtInModels?: readonly BuiltInModel[];
}) {
  const { project } = useOrganizationTeamProject();
  const providers = evaluatorApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const { selectOptions } = useMemo(
    () =>
      modelSelectionFrom({
        providers: providers.data ?? [],
        options,
        mode,
        featureKey: undefined,
        builtInModels,
      }),
    [providers.data, options, mode, builtInModels],
  );
  return {
    modelOption: selectOptions.find((option) => option.value === model),
    isLoading: providers.isLoading,
    isEmpty: selectOptions.length === 0,
  };
}
