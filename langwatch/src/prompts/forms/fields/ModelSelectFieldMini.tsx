import {
  Box,
  HStack,
  Popover as ChakraPopover,
  Skeleton,
} from "@chakra-ui/react";
import React, { useCallback, useState } from "react";
import { ChevronDown } from "react-feather";
import {
  Controller,
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form";
import {
  LLMConfigPopover,
  type Output,
  type OutputType,
} from "~/components/llmPromptConfigs/LLMConfigPopover";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "~/components/ModelSelector";
import { NoModelsConfiguredCallout } from "~/components/NoModelsConfiguredCallout";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import type { PromptConfigFormValues } from "~/prompts";
import type { LlmConfigOutputType } from "~/types";

type ModelSelectFieldMiniProps = {
  /** Whether to show the structured outputs section in the config popover */
  showStructuredOutputs?: boolean;
};

/**
 * Model Select Field Mini
 *
 * Renders a compact LLM model selector field integrated with react-hook-form
 * that displays the current model and opens a configuration popover on click.
 *
 * Uses Popover.Anchor instead of Popover.Trigger to avoid Zag.js's internal
 * onClick handler that conflicts with the Drawer's dismissable layer.
 * The onClick toggle is handled manually via controlled state.
 * See: https://github.com/langwatch/langwatch/issues/2390
 */
export const ModelSelectFieldMini = React.memo(function ModelSelectFieldMini({
  showStructuredOutputs = true,
}: ModelSelectFieldMiniProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { control, formState, trigger } =
    useFormContext<PromptConfigFormValues>();

  const outputsFieldArray = useFieldArray({
    control,
    name: "version.configData.outputs",
  });

  const watchedOutputs = useWatch({
    control,
    name: "version.configData.outputs",
  });

  const outputs: Output[] = (watchedOutputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
    json_schema: output.json_schema,
  }));

  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
      outputsFieldArray.replace(
        newOutputs.map((o) => ({
          identifier: o.identifier,
          type: o.type as LlmConfigOutputType,
          json_schema: o.json_schema as { type: string } | undefined,
        })),
      );
    },
    [outputsFieldArray],
  );

  // Hooked at the top level (not inside Controller's render callback) so
  // React doesn't complain about conditional hook order. The current
  // form value lives in form state; reading it here for the empty-state
  // check is cheap and the picker re-renders on form changes anyway.
  const watchedLlm = useWatch({ control, name: "version.configData.llm" });
  const { isEmpty, isLoading } = useModelSelectionOptions(
    allModelOptions,
    watchedLlm?.model ?? "",
    "chat",
  );

  if (isLoading) {
    // While the providers query is in flight, render a chip-shaped
    // placeholder instead of falling through to the empty-state callout
    // (which would flash "No models configured" for a frame before the
    // data resolves).
    return <Skeleton width="180px" height="32px" borderRadius="md" />;
  }

  if (isEmpty) {
    // Skip the popover trigger entirely when the project has zero
    // enabled providers — clicking the chip would just open a dropdown
    // with no items. Honest empty-state callout instead.
    //
    // The prompt-playground surface gets an open-by-default tooltip
    // ('Set up a model to get started') because the playground tries
    // to actually run the prompt the moment the user hits Send, so
    // the empty model picker is a far higher-stakes blocker here
    // than in the workflow / evaluator drawers. Chakra's tooltip
    // closes naturally on mouseout and re-opens on mouseover.
    return (
      <Tooltip
        content="Set up a model to get started"
        defaultOpen
        openDelay={0}
        showArrow
        positioning={{ placement: "top" }}
      >
        <Box>
          <NoModelsConfiguredCallout size="sm" />
        </Box>
      </Tooltip>
    );
  }

  return (
    <Controller
      key="version.configData.llm"
      name="version.configData.llm"
      control={control}
      render={({ field }) => {
        const llmErrors = formState.errors.version?.configData?.llm;
        return (
          <Popover.Root
            positioning={{ placement: "bottom-start" }}
            open={popoverOpen}
            onOpenChange={({ open }) => setPopoverOpen(open)}
          >
            <ChakraPopover.Anchor asChild>
              <HStack
                paddingY={2}
                paddingX={3}
                borderRadius="md"
                border="1px solid"
                borderColor="border"
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                transition="background 0.15s"
                justify="space-between"
                onClick={() => setPopoverOpen((prev) => !prev)}
              >
                <LLMModelDisplay model={field.value?.model ?? ""} />
                <Box color="fg.muted">
                  <ChevronDown size={16} />
                </Box>
              </HStack>
            </ChakraPopover.Anchor>
            <LLMConfigPopover
              values={field.value}
              onChange={(values) => {
                field.onChange(values);
                void trigger?.("version.configData.llm");
              }}
              errors={llmErrors}
              outputs={outputs}
              onOutputsChange={handleOutputsChange}
              showStructuredOutputs={showStructuredOutputs}
            />
          </Popover.Root>
        );
      }}
    />
  );
});
