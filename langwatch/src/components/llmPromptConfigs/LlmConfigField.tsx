import { Box, HStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";

import {
  LLMConfigPopover,
  type Output,
} from "~/components/llmPromptConfigs/LLMConfigPopover";
import { AddModelProviderKey } from "~/optimization_studio/components/AddModelProviderKey";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import type { ModelOption } from "~/server/topicClustering/types";
import { Popover } from "../ui/popover";
import { LLMModelDisplay } from "./LLMModelDisplay";

type LLMConfigFieldProps = {
  llmConfig: LLMConfig;
  modelOption?: ModelOption;
  requiresCustomKey: boolean;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
  /** Outputs configuration (for structured outputs) */
  outputs?: Output[];
  /** Callback when outputs change */
  onOutputsChange?: (outputs: Output[]) => void;
  /** Whether to show the structured outputs section */
  showStructuredOutputs?: boolean;
};

/**
 * LLM Config field
 * Can be used outside of the form context (does not use react-hook-form)
 *
 * Displays a compact clickable row with model info and ChevronDown icon.
 * Clicking opens the LLMConfigPopover for model and parameter configuration.
 */
export function LLMConfigField({
  llmConfig,
  onChange,
  modelOption,
  requiresCustomKey,
  showProviderKeyMessage = true,
  outputs,
  onOutputsChange,
  showStructuredOutputs = false,
}: LLMConfigFieldProps) {
  const { model } = llmConfig ?? {};

  // Check if the model is disabled (has line-through styling)
  const isModelDisabled = modelOption?.isDisabled ?? false;

  return (
    <>
      <Popover.Root positioning={{ placement: "bottom-start" }} closeOnInteractOutside={false}>
        <Popover.Trigger asChild>
          <HStack
            width="full"
            paddingY={2}
            paddingX={3}
            borderRadius="md"
            border="1px solid"
            borderColor="border"
            cursor="pointer"
            _hover={{ bg: "bg.subtle" }}
            transition="background 0.15s"
            justify="space-between"
            opacity={modelOption?.isDisabled ? 0.5 : 1}
          >
            <LLMModelDisplay model={model ?? ""} />
            <Box color="fg.muted">
              <ChevronDown size={16} />
            </Box>
          </HStack>
        </Popover.Trigger>

        <LLMConfigPopover
          values={llmConfig}
          onChange={onChange}
          outputs={outputs}
          onOutputsChange={onOutputsChange}
          showStructuredOutputs={showStructuredOutputs}
        />
      </Popover.Root>
      {(requiresCustomKey || isModelDisabled) && showProviderKeyMessage && (
        <AddModelProviderKey
          runWhat="run this component"
          nodeProvidersWithoutCustomKeys={[model?.split("/")[0] ?? "unknown"]}
        />
      )}
    </>
  );
}
