import {
  Box,
  Button,
  HStack,
  Input,
  Link,
  Spacer,
  Text,
  Tooltip,
  useDisclosure,
} from "@chakra-ui/react";
import { Settings, X } from "react-feather";
import { HorizontalFormControl } from "../../../../components/HorizontalFormControl";
import { Sliders2 } from "../../../../components/icons/Sliders2";
import {
  allModelOptions,
  ModelSelector,
  useModelSelectionOptions,
} from "../../../../components/ModelSelector";
import type { LLMConfig } from "../../../types/dsl";
import { ConfigModal } from "./ConfigModal";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import { AddModelProviderKey } from "../../AddModelProviderKey";

export function LLMModelDisplay({
  model,
  fontSize = 14,
  showVersion = true,
}: {
  model: string;
  fontSize?: number;
  showVersion?: boolean;
}) {
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat"
  );

  return (
    <>
      <Box width="14px" minWidth="14px">
        {modelOption?.icon}
      </Box>
      <Box
        fontSize={fontSize}
        fontFamily="mono"
        noOfLines={1}
        wordBreak="break-all"
      >
        {modelOption?.label}
        {modelOption?.isDisabled && (
          <>
            {" "}
            <Text
              as="span"
              fontSize={fontSize}
              fontFamily="mono"
              color="gray.500"
              opacity={modelOption?.isDisabled ? 0.5 : 1}
            >
              (disabled)
            </Text>
          </>
        )}
      </Box>
    </>
  );
}

export function LLMConfigField({
  allowDefault = undefined,
  llmConfig,
  defaultLLMConfig = undefined,
  onChange,
}:
  | {
      allowDefault: true;
      llmConfig: LLMConfig | undefined;
      defaultLLMConfig: LLMConfig;
      onChange: (llmConfig: LLMConfig | undefined) => void;
    }
  | {
      allowDefault?: undefined;
      llmConfig: LLMConfig;
      defaultLLMConfig?: undefined;
      onChange: (llmConfig: LLMConfig) => void;
    }) {
  const { isOpen, onClose, onToggle } = useDisclosure();

  const model = llmConfig?.model ?? defaultLLMConfig!.model;
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat"
  );

  const { hasCodeNodes } = useWorkflowStore((state) => ({
    hasCodeNodes: state.nodes.some((node) => node.type === "code"),
  }));

  const { modelProviders } = useOrganizationTeamProject();
  const hasCustomKeys = Object.values(modelProviders ?? {}).some(
    (modelProvider) =>
      model.split("/")[0] === modelProvider.provider && modelProvider.customKeys
  );
  const requiresCustomKey = hasCodeNodes && !hasCustomKeys;

  return (
    <>
      <LLMConfigModal
        isOpen={isOpen}
        onClose={onClose}
        llmConfig={llmConfig ?? defaultLLMConfig!}
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
            label="Overriding default LLM, click to reset"
            placement="top"
            hasArrow
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
        <HStack width="full" gap={2}>
          <ModelSelector
            model={llmConfig.model ?? ""}
            options={allModelOptions}
            onChange={(model) => onChange({ ...llmConfig, model })}
            mode="chat"
            size="full"
          />
          <Tooltip label="Configure available models" placement="top" hasArrow>
            <Button
              as={Link}
              size="sm"
              variant="ghost"
              href="/settings/model-providers"
              target="_blank"
            >
              <Settings size={16} />
            </Button>
          </Tooltip>
        </HStack>
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
        helper={"Limit to avoid expensive outputs"}
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
