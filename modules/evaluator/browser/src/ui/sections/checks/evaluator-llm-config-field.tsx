import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { NoModelsConfiguredCallout } from "@langwatch/design-system/no-models-configured-callout";
import { Popover } from "@langwatch/design-system/popover";
import { Box, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderIconGlyph } from "@langwatch/design-system/provider-icons";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { allModelOptions } from "@langwatch/model-provider-contract";
import { MODEL_ICON_SIZE } from "@langwatch/prompt-contract/llm-config-constants";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { useCallback, useMemo } from "react";
import { ChevronDown } from "react-feather";
import { useFormContext, useWatch } from "react-hook-form";

import { LLMModelDisplay } from "../../../behavior/lent-model-provider.tsx";
import { LLMConfigPopover } from "../../../behavior/lent-peers.tsx";
import { useInstantEvalJudgeModels } from "../../../behavior/use-instant-eval-judge-models.ts";
import { useModelSelection } from "../../../behavior/use-model-selection.ts";
import {
  INSTANT_EVALS_BUILT_IN_MODEL,
  isInstantEvalJudgeSlot,
} from "../../../model/instant-eval-judge-models.ts";
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
 * A model saved on Instant Evals where it is not offered reads by its name, not as a
 * broken id: not released for a judge, and never run for any other evaluator.
 */
function InstantEvalsNotOffered({ evaluatorType }: { evaluatorType: string | undefined }) {
  return (
    <HStack align="center" gap={2}>
      <ProviderIconGlyph provider="langwatch" size={MODEL_ICON_SIZE} />
      <VStack gap={0} align="start">
        <Text fontSize="14px" fontFamily="mono" color="fg.muted">
          {INSTANT_EVALS_BUILT_IN_MODEL.label}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {isInstantEvalJudgeSlot({ evaluatorType })
            ? "Not enabled for this project"
            : "Only LLM judges run on Instant Evals"}
        </Text>
      </VStack>
    </HStack>
  );
}

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
  /** The evaluator this model belongs to: only an LLM judge is offered Instant Evals. */
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
      for (const key of LLM_CONFIG_KEYS) {
        setValue(`${prefix}.${key}`, incoming.get(key), { shouldDirty: true });
      }
    },
    [prefix, setValue],
  );

  // No enabled provider skips the popover for the same empty state as the prompt and
  // workflow pickers, behind a skeleton while providers load so it never flashes.
  // Instant Evals needs no provider, so a judge it is offered to keeps the picker.
  const { project, organization } = useOrganizationTeamProject();
  const instantEvals = useInstantEvalJudgeModels({
    projectId: project?.id,
    organizationId: organization?.id,
    evaluatorType,
  });
  const { builtInModels } = instantEvals;
  const { isEmpty, isLoading } = useModelSelection({
    options: allModelOptions,
    model: llmConfig.model,
    mode: "chat",
    builtInModels,
  });
  const isInstantEvalsSaved = llmConfig.model === INSTANT_EVAL_JUDGE_MODEL_ID;
  if (isLoading || (instantEvals.isLoading && (isEmpty || isInstantEvalsSaved))) {
    return <Skeleton width="full" height="40px" borderRadius="md" />;
  }
  const isInstantEvalsNotOffered = isInstantEvalsSaved && !instantEvals.offered;
  if (isEmpty) {
    return isInstantEvalsNotOffered ? (
      <VStack width="full" align="stretch" gap={2}>
        <InstantEvalsNotOffered evaluatorType={evaluatorType} />
        <NoModelsConfiguredCallout size="sm" />
      </VStack>
    ) : (
      <NoModelsConfiguredCallout size="sm" />
    );
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
          _hover={{ bg: "gray.50" }}
          transition="background 0.15s"
          justify="space-between"
        >
          {isInstantEvalsNotOffered ? (
            <InstantEvalsNotOffered evaluatorType={evaluatorType} />
          ) : (
            <LLMModelDisplay model={llmConfig.model} builtInModels={builtInModels} />
          )}
          <Box color="fg.muted">
            <ChevronDown size={16} />
          </Box>
        </HStack>
      </Popover.Trigger>
      <LLMConfigPopover values={llmConfig} onChange={handleChange} builtInModels={builtInModels} />
    </Popover.Root>
  );
};
