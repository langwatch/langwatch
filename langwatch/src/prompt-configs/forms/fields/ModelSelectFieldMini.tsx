import { useFormContext, Controller } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { LLMConfigModal } from "~/components/llmPromptConfigs/LLMConfigModal";
import { HStack, useDisclosure } from "@chakra-ui/react";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import { ChevronDown } from "react-feather";

/**
 * Model Select Field Mini
 *
 * Single Responsibility: Renders a compact LLM model selector field integrated with react-hook-form
 * that displays the current model and opens a configuration modal on click.
 *
 * Can be used within a FormProvider context (uses react-hook-form Controller)
 */
export function ModelSelectFieldMini() {
  const { control } = useFormContext<PromptConfigFormValues>();
  const { open, onClose, onToggle } = useDisclosure();

  return (
    <>
      <Controller
        name="version.configData.llm"
        control={control}
        render={({ field }) => {
          return (
            <>
              <HStack
                border="1px solid"
                borderColor={open ? "blue.200" : "gray.200"}
                bg={open ? "blue.50" : "white"}
                borderRadius="sm"
                padding="1"
                cursor="pointer"
                position="relative"
              >
                <HStack onClick={onToggle} width="full">
                  <LLMModelDisplay model={field.value?.model ?? ""} />
                  <ChevronDown size={16} />
                </HStack>
              </HStack>
              <LLMConfigModal
                open={open}
                onClose={onClose}
                values={field.value}
                onChange={field.onChange}
              />
            </>
          );
        }}
      />
    </>
  );
}
