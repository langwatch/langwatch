/** The models Langy's picker offers: the project's stored providers, gated by Langy's feature. */

import { modelSelectionFrom } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";

export function useLangyModelOptions({
  options,
  model,
  featureKey,
}: {
  options: string[];
  model: string;
  featureKey: string;
}) {
  const projectId = useOrganizationTeamProject().project?.id;
  const providers = api.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const { selectOptions } = useMemo(
    () =>
      modelSelectionFrom({ providers: providers.data ?? [], options, mode: "chat", featureKey }),
    [providers.data, options, featureKey],
  );
  const modelOption = selectOptions.find((option) => option.value === model);
  return { selectOptions, modelOption };
}
