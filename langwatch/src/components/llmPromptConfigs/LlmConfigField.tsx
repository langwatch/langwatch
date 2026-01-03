import { Box, Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { X } from "react-feather";
import { LLMConfigPopover } from "~/components/llmPromptConfigs/LLMConfigPopover";
import { AddModelProviderKey } from "~/optimization_studio/components/AddModelProviderKey";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import type { ModelOption } from "~/server/topicClustering/types";
import { Sliders2 } from "../icons/Sliders2";
import { Popover } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { LLMModelDisplay } from "./LLMModelDisplay";

type LLMConfigFieldProps = {
  llmConfig: LLMConfig;
  modelOption?: ModelOption;
  allowDefault?: boolean;
  requiresCustomKey: boolean;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
};

/**
 * LLM Config field
 * Can be used outside of the form context (does not use react-hook-form)
 */
export function LLMConfigField({
  allowDefault,
  llmConfig,
  onChange,
  modelOption,
  requiresCustomKey,
  showProviderKeyMessage = true,
}: LLMConfigFieldProps) {
  const { model } = llmConfig ?? {};

  // Check if the model is disabled (has line-through styling)
  const isModelDisabled = modelOption?.isDisabled ?? false;

  return (
    <>
      <HStack
        gap={2}
        paddingX={2}
        width="full"
        align="center"
        opacity={modelOption?.isDisabled ? 0.5 : 1}
        marginBottom={1}
      >
        <LLMModelDisplay model={model} />
        {allowDefault && llmConfig != undefined ? (
          <Tooltip
            content="Overriding default LLM, click to reset"
            positioning={{ placement: "top" }}
            showArrow
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(undefined as unknown as LLMConfig)}
            >
              <X size={16} />
            </Button>
          </Tooltip>
        ) : null}
        <Spacer />
        <Popover.Root positioning={{ placement: "bottom-end" }}>
          <Popover.Trigger asChild>
            <Button size="sm" variant="ghost">
              <Box minWidth="16px">
                <HStack gap={2} align="center">
                  <Sliders2 size={16} />
                  <Text>Switch Model</Text>
                </HStack>
              </Box>
            </Button>
          </Popover.Trigger>
          <LLMConfigPopover values={llmConfig} onChange={onChange} />
        </Popover.Root>
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
