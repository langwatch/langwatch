import { modelSelectionFrom } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

/** The project's pickable models for `mode`, and the chosen one among them. */
export const useModelSelectionOptions = ({
  options,
  model,
  mode = "chat",
  opts,
}: {
  options: string[];
  model: string;
  mode?: "chat" | "embedding";
  opts?: { featureKey?: string | undefined };
}) => {
  const { project } = usePromptProject();
  const providers = promptApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const featureKey = opts?.featureKey;
  const { selectOptions } = useMemo(
    () => modelSelectionFrom({ providers: providers.data ?? [], options, mode, featureKey }),
    [providers.data, options, mode, featureKey],
  );

  return {
    modelOption: selectOptions.find((option) => option.value === model),
    /** True while the providers query is in flight: show a skeleton, not the empty callout. */
    isLoading: providers.isLoading,
    /** True when the project has no models of `mode`: callers swap to the empty-state callout. */
    isEmpty: selectOptions.length === 0,
  };
};
