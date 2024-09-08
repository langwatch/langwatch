import { Button, HStack, Input, Spacer, Text, VStack } from "@chakra-ui/react";
import { X } from "react-feather";
import { HorizontalFormControl } from "../../../components/HorizontalFormControl";
import {
  allModelOptions,
  ModelSelector,
} from "../../../components/ModelSelector";
import type { LLMConfig } from "../../types/dsl";

export function LLMConfigModal({
  isOpen,
  onClose,
  llmConfig,
  onChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
}) {
  return (
    <ConfigModal isOpen={isOpen} onClose={onClose} title="LLM Config">
      <HorizontalFormControl
        label="Model"
        helper={"The LLM model to use"}
        inputWidth="55%"
      >
        <ModelSelector
          model={llmConfig.model ?? ""}
          options={allModelOptions}
          onChange={(model) => onChange({ ...llmConfig, model })}
          mode="chat"
          size="full"
        />
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Temperature"
        helper={"Controls randomness in the output"}
        inputWidth="55%"
      >
        <Input
          value={llmConfig.temperature}
          type="number"
          step={0.1}
          min={0}
          max={2}
          onChange={(e) =>
            onChange({ ...llmConfig, temperature: Number(e.target.value) })
          }
        />
      </HorizontalFormControl>
      <HorizontalFormControl
        label="Max Tokens"
        helper={"Avoid too expensive outputs"}
        inputWidth="55%"
      >
        <Input
          value={llmConfig.max_tokens}
          type="number"
          step={64}
          min={256}
          max={1048576}
          onChange={(e) =>
            onChange({ ...llmConfig, max_tokens: Number(e.target.value) })
          }
          onBlur={() => {
            if (llmConfig.max_tokens === 0) {
              onChange({ ...llmConfig, max_tokens: 2048 });
            }
          }}
        />
      </HorizontalFormControl>
    </ConfigModal>
  );
}

export function ConfigModal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack
      borderRadius="2px"
      border="1px solid"
      borderColor="gray.200"
      background="white"
      position="absolute"
      zIndex={100}
      minWidth="600px"
      transform="translateX(-100%)"
      left="-12px"
      spacing={0}
      display={isOpen ? "flex" : "none"}
    >
      <HStack
        width="full"
        paddingX={4}
        paddingY={2}
        paddingRight={1}
        borderBottom="1px solid"
        borderColor="gray.200"
      >
        <Text fontSize={14} fontWeight={500}>
          {title}
        </Text>
        <Spacer />
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X size={16} />
        </Button>
      </HStack>
      <VStack paddingY={2} paddingX={4} width="full" align="start">
        {children}
      </VStack>
    </VStack>
  );
}
