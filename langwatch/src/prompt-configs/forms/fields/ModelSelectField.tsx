import { useFormContext, Controller } from "react-hook-form";

import type { PromptConfigFormValues } from "~/prompt-configs";

import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "~/components/ModelSelector";
import { AddModelProviderKey } from "~/optimization_studio/components/AddModelProviderKey";
import { VStack } from "@chakra-ui/react";

export function ModelSelectField() {
  const { control, formState, watch } =
    useFormContext<PromptConfigFormValues>();
  const { errors } = formState;

  // Get the current model value from the form
  const currentLLMConfig = watch("version.configData.llm");
  const currentModel = currentLLMConfig?.model ?? "";

  // Check if the current model is disabled
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    currentModel,
    "chat"
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
                onChange={field.onChange}
                requiresCustomKey={false}
              />
            );
          }}
        />
      </VerticalFormControl>
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
