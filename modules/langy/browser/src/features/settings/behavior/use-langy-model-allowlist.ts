/** The models Langy may use in a project, as the settings page reads, edits and saves them. */

import { allModelOptions } from "@langwatch/model-provider-contract";
import { useState } from "react";

import { api } from "../../../behavior/langy-api.ts";
import { useLangyHost } from "../../../model/langy-host.ts";
import { LANGY_GATE_FEATURE_KEY } from "../../langy/behavior/panel/use-langy-composer-model.ts";
import { useLangyModelOptions } from "../../langy/behavior/panel/use-langy-model-options.ts";
import { isDefaultModelOutsideList } from "../model/langy-model-allowlist.ts";

export function useLangyModelAllowlist({ projectId }: { projectId: string }) {
  const host = useLangyHost();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<string[] | null>(null);
  const savedQuery = api.langy.modelsAllowed.useQuery({ projectId });
  const defaultQuery = api.modelProvider.getResolvedDefault.useQuery({
    projectId,
    featureKey: LANGY_GATE_FEATURE_KEY,
  });
  // The models the project's providers serve for Langy, as the composer's picker offers them.
  const { selectOptions } = useLangyModelOptions({
    options: allModelOptions,
    model: "",
    featureKey: LANGY_GATE_FEATURE_KEY,
  });
  const save = api.langy.setModelsAllowed.useMutation({
    onSuccess: (answer) => {
      utils.langy.modelsAllowed.setData({ projectId }, answer);
      setDraft(null);
      host.succeeded({ title: "Langy's models saved" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save Langy's models" }),
  });

  const saved = savedQuery.data?.modelsAllowed ?? [];
  const models = draft ?? saved;
  const defaultModel = defaultQuery.data?.model ?? null;

  return {
    models,
    setModels: setDraft,
    options: {
      data: selectOptions.map(({ value, label }) => ({ value, label })),
      isLoading: savedQuery.isLoading,
      error: savedQuery.error ?? undefined,
    },
    defaultModel,
    isDefaultOutsideList: isDefaultModelOutsideList({ defaultModel, models }),
    isSaving: save.isPending,
    save: () => save.mutate({ projectId, modelsAllowed: models }),
  };
}
