import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { NoModelsConfiguredCallout } from "@langwatch/design-system/no-models-configured-callout";
import { Popover } from "@langwatch/design-system/popover";
import { Box, HStack, Skeleton } from "@langwatch/design-system/primitives";
import {
  allModelOptions,
  judgeShownModelIdOf,
  LANGWATCH_DECISION_MODEL_ID,
} from "@langwatch/model-provider-contract";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { useCallback, useMemo } from "react";
import { ChevronDown } from "react-feather";
import { useFormContext, useWatch } from "react-hook-form";

import { LLMModelDisplay } from "../../../behavior/lent-model-provider.tsx";
import { LLMConfigPopover } from "../../../behavior/lent-peers.tsx";
import { useInstantEvalJudgeModels } from "../../../behavior/use-instant-eval-judge-models.ts";
import { useModelSelection } from "../../../behavior/use-model-selection.ts";
import { toInternalKey } from "../prompt/llm-parameters/parameter-config.ts";

/**
 * LLM config parameter keys that the popover can read/write.
 * Used to bridge react-hook-form fields with LLMConfigPopover's object API.
 */
export const LLM_CONFIG_KEYS = [
  "model",
  "max_tokens",
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "top_k",
  "min_p",
  "repetition_penalty",
  "reasoning",
  "verbosity",
] as const;

/**
 * Bridges react-hook-form's flat structure with LLMConfigPopover's
 * object-based API: reads params from form context, builds an LLMConfig
 * object, writes changed params back on change.
 */
export const EvaluatorLLMConfigField = ({
  prefix,
  evaluatorType,
}: {
  prefix: string;
  /** Only the evaluators Instant Evals answers are offered LangWatch's and own decision models. */
  evaluatorType: string | undefined;
}) => {
  const { setValue, control } = useFormContext();

  // Watch all LLM config fields for changes
  const watchedValues = useWatch({
    control,
    name: LLM_CONFIG_KEYS.map((key) => `${prefix}.${key}`),
  }) as (string | number | undefined)[];

  // Construct LLMConfig object from watched values
  const llmConfig: LLMConfig = useMemo(() => {
    const config: Partial<Record<(typeof LLM_CONFIG_KEYS)[number], string | number>> = {};
    LLM_CONFIG_KEYS.forEach((key, index) => {
      const val = watchedValues[index];
      if (val !== undefined) {
        config[key] = val;
      }
    });
    config.model = (config.model as string) ?? "";
    return config as LLMConfig;
  }, [watchedValues]);

  // Zero enabled providers shows the empty state shared with the prompt playground and
  // workflow pickers; a skeleton renders while either query is in flight. An unanswered
  // decision model list is not an empty one: showing the model against it marks a judge
  // saved on an own decision model as needing an update when nothing is wrong with it.
  const { project, organization } = useOrganizationTeamProject();
  const instantEvals = useInstantEvalJudgeModels({
    projectId: project?.id,
    organizationId: organization?.id,
    evaluatorType,
  });
  const { builtInModels, shownModels, isJudgeRouted } = instantEvals;
  // Any hosted id shows as the one the picker offers; the stored value changes only on a pick.
  const judgeModel = judgeShownModelIdOf({ id: llmConfig.model, isJudgeRouted });
  const shownConfig: LLMConfig = { ...llmConfig, model: judgeModel };
  // A judge that holds the LangWatch Instant (preview) id where the flag is on finds its row in the
  // picker.
  const popoverModels = judgeModel === LANGWATCH_DECISION_MODEL_ID ? shownModels : builtInModels;
  // Handle changes from LLMConfigPopover — write all keys back to form.
  // We iterate over LLM_CONFIG_KEYS (not just newConfig entries) so that
  // cleared fields (e.g. reasoning removed on model switch) are set to
  // undefined, preventing stale values from persisting.
  const handleChange = useCallback(
    (newConfig: LLMConfig) => {
      const incoming = new Map<string, string | number | undefined>();
      for (const [key, value] of Object.entries(newConfig)) {
        incoming.set(toInternalKey(key), value as string | number | undefined);
      }
      // The popover holds the shown id; a model the user did not change keeps its stored id.
      if (incoming.get("model") === judgeModel) incoming.set("model", llmConfig.model);
      for (const key of LLM_CONFIG_KEYS) {
        setValue(`${prefix}.${key}`, incoming.get(key), { shouldDirty: true });
      }
    },
    [prefix, setValue, judgeModel, llmConfig.model],
  );

  const { isEmpty, isLoading } = useModelSelection({
    options: allModelOptions,
    model: judgeModel,
    mode: "chat",
    builtInModels,
  });
  if (isLoading || instantEvals.isLoading) {
    return <Skeleton width="full" height="40px" borderRadius="md" />;
  }
  if (isEmpty) {
    return <NoModelsConfiguredCallout size="sm" />;
  }

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        <HStack
          width="full"
          paddingY={2}
          paddingX={3}
          borderRadius="md"
          border="1px solid"
          borderColor="border"
          cursor="pointer"
          _hover={{ bg: "bg.subtle" }}
          transition="background 0.15s"
          justify="space-between"
        >
          <LLMModelDisplay model={judgeModel} builtInModels={shownModels} />
          <Box color="fg.muted">
            <ChevronDown size={16} />
          </Box>
        </HStack>
      </Popover.Trigger>
      <LLMConfigPopover
        values={shownConfig}
        onChange={handleChange}
        builtInModels={popoverModels}
      />
    </Popover.Root>
  );
};
