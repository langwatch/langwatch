import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { getEvaluatorDefaultSettings } from "@langwatch/evaluator-contract";
import { DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import { DEFAULT_EMBEDDINGS_MODEL } from "@langwatch/workflow-browser-kit";
import { useEffect, useEffectEvent } from "react";
import type { UseFormReturn } from "react-hook-form";

import { evaluatorApi } from "../../../behavior/evaluator-api.ts";
import { useAvailableEvaluators } from "../../../behavior/use-available-evaluators.ts";

type SettingsForm = UseFormReturn<{ settings: Record<string, unknown> }>;

function applyDefaults({
  form,
  defaults,
  prefix,
}: {
  form: SettingsForm;
  defaults: object;
  prefix: string;
}) {
  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      applyDefaults({ form, defaults: value, prefix: `${prefix}.${key}` });
      continue;
    }
    // @ts-expect-error: runtime-built path not a literal form field
    form.setValue(`${prefix}.${key}`, value);
  }
}

/** Fills the evaluator's defaults, preferring the project's configured models once they resolve. */
export function useEvaluatorDefaultSettings({
  form,
  evaluatorType,
  enabled,
}: {
  form: SettingsForm;
  evaluatorType: string;
  enabled: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  const resolvedDefaultModel = evaluatorApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );
  const resolvedDefaultEmbeddings = evaluatorApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "analytics.topic_clustering_embeddings" },
    { enabled: !!project?.id },
  );
  const availableEvaluators = useAvailableEvaluators();

  const fillDefaults = useEffectEvent(() => {
    if (!enabled || !availableEvaluators || !(evaluatorType in availableEvaluators)) return;
    applyDefaults({
      form,
      defaults: getEvaluatorDefaultSettings(
        availableEvaluators[evaluatorType],
        {
          defaultModel: resolvedDefaultModel.data?.model ?? null,
          embeddingsModel: resolvedDefaultEmbeddings.data?.model ?? null,
        },
        { defaultModel: DEFAULT_MODEL, embeddingsModel: DEFAULT_EMBEDDINGS_MODEL },
      ),
      prefix: "settings",
    });
  });

  useEffect(() => {
    fillDefaults();
  }, [evaluatorType, resolvedDefaultModel.data?.model, resolvedDefaultEmbeddings.data?.model]);
}
