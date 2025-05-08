import { useDisclosure } from "@chakra-ui/react";
import { HStack, Button, Spacer, Box } from "@chakra-ui/react";
import { X } from "react-feather";

import type { ModelOption } from "~/server/topicClustering/types";

import { Sliders2 } from "../icons/Sliders2";
import { Tooltip } from "../ui/tooltip";

import { LLMModelDisplay } from "./LLMModelDisplay";

import { LLMConfigModal } from "~/components/llmPromptConfigs/LLMConfigModal";
import { AddModelProviderKey } from "~/optimization_studio/components/AddModelProviderKey";
import type { LLMConfig } from "~/optimization_studio/types/dsl";

interface LLMConfigFieldProps {
  llmConfig: LLMConfig;
  modelOption?: ModelOption;
  allowDefault?: boolean;
  requiresCustomKey: boolean;
  onChange: (llmConfig: LLMConfig) => void;
}

export function LLMConfigField({
  allowDefault,
  llmConfig,
  onChange,
  modelOption,
  requiresCustomKey,
}: LLMConfigFieldProps) {
  const { open, onClose, onToggle } = useDisclosure();
  const { model } = llmConfig;

  return (
    <>
      <LLMConfigModal
        open={open}
        onClose={onClose}
        llmConfig={llmConfig}
        onChange={onChange}
      />
      <HStack
        gap={2}
        paddingX={2}
        width="full"
        align="center"
        opacity={modelOption?.isDisabled ? 0.5 : 1}
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
              onClick={() => onChange(undefined as any)}
            >
              <X size={16} />
            </Button>
          </Tooltip>
        ) : null}
        <Spacer />
        <Button size="sm" variant="ghost" onClick={onToggle}>
          <Box minWidth="16px">
            <Sliders2 size={16} />
          </Box>
        </Button>
      </HStack>
      {requiresCustomKey && (
        <AddModelProviderKey
          runWhat="run this component"
          nodeProvidersWithoutCustomKeys={[model.split("/")[0] ?? "unknown"]}
        />
      )}
    </>
  );
}
