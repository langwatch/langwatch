import { useFormContext, Controller } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { LLMConfigModal } from "~/components/llmPromptConfigs/LLMConfigModal";
import { Box, HStack, useDisclosure } from "@chakra-ui/react";
import { LLMModelDisplay } from "~/components/llmPromptConfigs/LLMModelDisplay";
import { ChevronDown } from "react-feather";

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
                borderRadius="md"
                padding="2"
                cursor="pointer"
                onClick={onToggle}
                position="relative"
              >
                <LLMModelDisplay model={field.value?.model ?? ""} />
                <ChevronDown size={16} />
                <LLMConfigModal
                  open={open}
                  onClose={onClose}
                  values={field.value}
                  onChange={field.onChange}
                />
              </HStack>
            </>
          );
        }}
      />
    </>
  );
}
