import { Button, HStack, useDisclosure } from "@chakra-ui/react";
import React from "react";
import { ChevronDown } from "react-feather";
import { Controller, useFormContext } from "react-hook-form";
import { LLMConfigModal } from "~/components/llmPromptConfigs/LLMConfigModal";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import type { PromptConfigFormValues } from "~/prompts";

/**
 * Model Select Field Mini
 *
 * Single Responsibility: Renders a compact LLM model selector field integrated with react-hook-form
 * that displays the current model and opens a configuration modal on click.
 *
 * Can be used within a FormProvider context (uses react-hook-form Controller)
 */
export const ModelSelectFieldMini = React.memo(function ModelSelectFieldMini() {
  const { control, formState, trigger } =
    useFormContext<PromptConfigFormValues>();
  const { open, onClose, onToggle } = useDisclosure();

  return (
    <>
      <Controller
        key="version.configData.llm"
        name="version.configData.llm"
        control={control}
        render={({ field }) => {
          const llmErrors = formState.errors.version?.configData?.llm;
          return (
            <>
              <Button
                key="llm-model-display"
                variant="outline"
                position="relative"
                onClick={onToggle}
                fontWeight="normal"
                _active={{ bg: "gray.50" }}
              >
                <LLMModelDisplay model={field.value?.model ?? ""} />
                <ChevronDown size={16} />
              </Button>
              <LLMConfigModal
                key="llm-config-modal"
                open={open}
                onClose={onClose}
                values={field.value}
                onChange={(values) => {
                  field.onChange(values);
                  void trigger?.("version.configData.llm");
                }}
                errors={llmErrors}
              />
            </>
          );
        }}
      />
    </>
  );
});
