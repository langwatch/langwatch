import { VStack } from "@chakra-ui/react";
import { Controller, useFormContext } from "react-hook-form";

import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "~/components/ModelSelector";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { AddModelProviderKey } from "~/optimization_studio/components/AddModelProviderKey";
import type { PromptConfigFormValues } from "~/prompts";

export function ModelSelectField() {
  const { control, formState, watch, trigger } =
    useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  // Get the current model value from the form
  const currentLLMConfig = watch("version.configData.llm");
  const currentModel = currentLLMConfig?.model ?? "";

  // Check if the current model is disabled
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    currentModel,
    "chat",
  );
  const isModelDisabled = modelOption?.isDisabled ?? false;

  return (
    <VStack align="start" width="full">
      <VerticalFormControl
        label="Model"
        invalid={!!errors.version?.configData?.llm}
        helper={errors.version?.configData?.llm?.message?.toString()}
        error={errors.version?.configData?.llm}
        size="sm"
      >
        <Controller
          name="version.configData.llm"
          control={control}
          render={({ field }) => {
            return (
              <LLMConfigField
                llmConfig={field.value}
                onChange={(values) => {
                  field.onChange(values);
                  void trigger?.("version.configData.llm");
                }}
                requiresCustomKey={false}
              />
            );
          }}
        />
      </VerticalFormControl>
      {/**
       * TODO: Remove?
       * I don't think we need this here,
       * as it's already integrated with the LLMConfigField
       */}
      {isModelDisabled && (
        <AddModelProviderKey
          runWhat="run this prompt"
          nodeProvidersWithoutCustomKeys={[
            currentModel.split("/")[0] ?? "unknown",
          ]}
        />
      )}
    </VStack>
  );
}
