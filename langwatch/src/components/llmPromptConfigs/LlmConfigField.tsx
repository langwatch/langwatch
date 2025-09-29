import { useDisclosure } from "@chakra-ui/react";
import { HStack, Button, Spacer, Box, Text } from "@chakra-ui/react";
import { X } from "react-feather";

import type { ModelOption } from "~/server/topicClustering/types";

import { Sliders2 } from "../icons/Sliders2";
import { Tooltip } from "../ui/tooltip";

import { LLMModelDisplay } from "./LLMModelDisplay";

import { LLMConfigModal } from "~/components/llmPromptConfigs/LLMConfigModal";
import { AddModelProviderKey } from "~/optimization_studio/components/AddModelProviderKey";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { useFormContext } from "react-hook-form";
import { type PromptConfigFormValues } from "~/prompt-configs";

interface LLMConfigFieldProps {
  llmConfig: LLMConfig;
  modelOption?: ModelOption;
  allowDefault?: boolean;
  requiresCustomKey: boolean;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
}

export function LLMConfigField({
  allowDefault,
  modelOption,
  requiresCustomKey,
  showProviderKeyMessage = true,
}: LLMConfigFieldProps) {
  const { open, onClose, onToggle } = useDisclosure();
  const form = useFormContext<PromptConfigFormValues>();
  const model = form.watch("version.configData.llm.model");

  // Check if the model is disabled (has line-through styling)
  const isModelDisabled = modelOption?.isDisabled ?? false;

  return (
    <>
      <LLMConfigModal
        open={open}
        onClose={onClose}
      />
      <HStack
        gap={2}
        paddingX={2}
        width="full"
        align="center"
        opacity={modelOption?.isDisabled ? 0.5 : 1}
        marginBottom={1}
      >
        <LLMModelDisplay model={model} />
        {allowDefault && model != undefined ? (
          <Tooltip
            content="Overriding default LLM, click to reset"
            positioning={{ placement: "top" }}
            showArrow
          >
            <Button
              size="sm"
              variant="ghost"
              // TODO: I don't think this is correct? But the behavior before was confusing
              onClick={() => form.setValue("version.configData.llm.model", undefined as any)}
            >
              <X size={16} />
            </Button>
          </Tooltip>
        ) : null}
        <Spacer />
        <Button size="sm" variant="ghost" onClick={onToggle}>
          <Box minWidth="16px">
            <HStack gap={2} align="center">
              <Sliders2 size={16} />

              <Text>Switch Model</Text>
            </HStack>
          </Box>
        </Button>
      </HStack>
      {(requiresCustomKey || isModelDisabled) && showProviderKeyMessage && (
        <AddModelProviderKey
          runWhat="run this component"
          nodeProvidersWithoutCustomKeys={[model.split("/")[0] ?? "unknown"]}
        />
      )}
    </>
  );
}
