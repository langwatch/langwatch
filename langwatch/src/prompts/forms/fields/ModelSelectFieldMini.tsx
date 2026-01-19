import { Box, HStack } from "@chakra-ui/react";
import React, { useCallback } from "react";
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
import { Popover } from "~/components/ui/popover";
import type { PromptConfigFormValues } from "~/prompts";
import type { LlmConfigOutputType } from "~/types";

type ModelSelectFieldMiniProps = {
  /** Whether to show the structured outputs section in the config popover */
  showStructuredOutputs?: boolean;
};

/**
 * Model Select Field Mini
 *
 * Single Responsibility: Renders a compact LLM model selector field integrated with react-hook-form
 * that displays the current model and opens a configuration popover on click.
 *
 * Can be used within a FormProvider context (uses react-hook-form Controller)
 */
export const ModelSelectFieldMini = React.memo(function ModelSelectFieldMini({
  showStructuredOutputs = true,
}: ModelSelectFieldMiniProps) {
  const { control, formState, trigger } =
    useFormContext<PromptConfigFormValues>();

  // Outputs field array for structured outputs
  const outputsFieldArray = useFieldArray({
    control,
    name: "version.configData.outputs",
  });

  // Watch outputs for the popover
  const watchedOutputs = useWatch({
    control,
    name: "version.configData.outputs",
  });

  // Convert watched outputs to Output[] for LLMConfigPopover
  const outputs: Output[] = (watchedOutputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
    json_schema: output.json_schema,
  }));

  // Handle outputs change from LLMConfigPopover
  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
      outputsFieldArray.replace(
        newOutputs.map((o) => ({
          identifier: o.identifier,
          type: o.type as LlmConfigOutputType,
          json_schema: o.json_schema as { type: string } | undefined,
        }))
      );
    },
    [outputsFieldArray]
  );

  return (
    <Controller
      key="version.configData.llm"
      name="version.configData.llm"
      control={control}
      render={({ field }) => {
        const llmErrors = formState.errors.version?.configData?.llm;
        return (
          <Popover.Root positioning={{ placement: "bottom-start" }}>
            <Popover.Trigger asChild>
              <HStack
                width="2/3"
                paddingY={2}
                paddingX={3}
                borderRadius="md"
                border="1px solid"
                borderColor="gray.200"
                cursor="pointer"
                _hover={{ bg: "gray.50" }}
                transition="background 0.15s"
                justify="space-between"
              >
                <LLMModelDisplay model={field.value?.model ?? ""} />
                <Box color="gray.500">
                  <ChevronDown size={16} />
                </Box>
              </HStack>
            </Popover.Trigger>
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
