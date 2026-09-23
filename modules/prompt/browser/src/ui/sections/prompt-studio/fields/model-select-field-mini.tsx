import { Box, Popover as ChakraPopover, HStack, Skeleton } from "@chakra-ui/react";
import { Popover } from "@langwatch/design-system/popover";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { type LlmConfigOutputType, type PromptConfigFormValues } from "@langwatch/prompt-contract";
import { ChevronDown } from "lucide-react";
import React, { useCallback, useState } from "react";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";

import {
  LLMConfigPopover,
  type Output,
  type OutputType,
} from "../model-selection/llm-config-popover.tsx";
import { LLMModelDisplay } from "../model-selection/llm-model-display.tsx";
import { allModelOptions, useModelSelectionOptions } from "../model-selection/model-selector.tsx";
import { NoModelsConfiguredCallout } from "../model-selection/no-models-configured-callout.tsx";

type ModelSelectFieldMiniProps = {
  /** Whether to show the structured outputs section in the config popover */
  showStructuredOutputs?: boolean;
};

/**
 * Uses `Popover.Anchor` instead of `Popover.Trigger` to avoid Zag.js's internal onClick handler
 * conflicting with the Drawer's dismissable layer; the onClick toggle is handled manually via
 * controlled state. See https://github.com/langwatch/langwatch/issues/2390
 */
export const ModelSelectFieldMini = React.memo(function ModelSelectFieldMini({
  showStructuredOutputs = true,
}: ModelSelectFieldMiniProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { control, formState, trigger } = useFormContext<PromptConfigFormValues>();

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
  const { isEmpty, isLoading } = useModelSelectionOptions({
    options: allModelOptions,
    model: watchedLlm?.model ?? "",
    mode: "chat",
  });

  if (isLoading) {
    // While the providers query is in flight, render a chip-shaped
    // placeholder instead of falling through to the empty-state callout
    // (which would flash "No models configured" for a frame before the
    // data resolves).
    return <Skeleton width="180px" height="32px" borderRadius="md" />;
  }

  if (isEmpty) {
    // No enabled providers: skip the popover trigger (there'd be nothing to pick from) for an
    // honest empty-state callout instead. The prompt-playground surface additionally opens the
    // tooltip by default, because it runs the prompt the moment the user hits Send, making the
    // empty picker a higher-stakes blocker there than in the workflow/evaluator drawers.
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
