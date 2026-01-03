import { Button } from "@chakra-ui/react";
import React from "react";
import { ChevronDown } from "react-feather";
import { Controller, useFormContext } from "react-hook-form";
import { LLMConfigPopover } from "~/components/llmPromptConfigs/LLMConfigPopover";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import type { PromptConfigFormValues } from "~/prompts";
import { Popover } from "~/components/ui/popover";

/**
 * Model Select Field Mini
 *
 * Single Responsibility: Renders a compact LLM model selector field integrated with react-hook-form
 * that displays the current model and opens a configuration popover on click.
 *
 * Can be used within a FormProvider context (uses react-hook-form Controller)
 */
export const ModelSelectFieldMini = React.memo(function ModelSelectFieldMini() {
  const { control, formState, trigger } =
    useFormContext<PromptConfigFormValues>();

  return (
    <Controller
      key="version.configData.llm"
      name="version.configData.llm"
      control={control}
      render={({ field }) => {
        const llmErrors = formState.errors.version?.configData?.llm;
        return (
          <Popover.Root positioning={{ placement: "bottom" }}>
            <Popover.Trigger asChild>
              <Button
                variant="outline"
                fontWeight="normal"
                _active={{ bg: "gray.50" }}
              >
                <LLMModelDisplay model={field.value?.model ?? ""} />
                <ChevronDown size={16} />
              </Button>
            </Popover.Trigger>
            <LLMConfigPopover
              values={field.value}
              onChange={(values) => {
                field.onChange(values);
                void trigger?.("version.configData.llm");
              }}
              errors={llmErrors}
            />
          </Popover.Root>
        );
      }}
    />
  );
});
