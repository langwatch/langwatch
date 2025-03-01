import { Box, Button, HStack, Input, Spacer, Text } from "@chakra-ui/react";
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
import { Link } from "../../../../components/ui/link";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useDisclosure } from "@chakra-ui/react";
import { OverflownTextWithTooltip } from "../../../../components/OverflownText";

export function LLMModelDisplay({
  model,
  fontSize = "14px",
}: {
  model: string;
  fontSize?: string;
}) {
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat"
  );

  const isDisabled = modelOption?.isDisabled || !modelOption?.label;

  return (
    <>
      {modelOption?.icon && (
        <Box width="14px" minWidth="14px">
          {modelOption?.icon}
        </Box>
      )}
      <OverflownTextWithTooltip
        label={`${modelOption?.label ?? model} ${
          modelOption?.isDisabled ? "(disabled)" : !modelOption?.label ? "(deprecated)" : ""
        }`}
        fontSize={fontSize}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={isDisabled ? "gray.500" : undefined}
        textDecoration={isDisabled ? "line-through" : undefined}
      >
        {modelOption?.label ?? model}
      </OverflownTextWithTooltip>
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
  const { open, onClose, onToggle } = useDisclosure();

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
        open={open}
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

export function LLMConfigModal({
  open,
  onClose,
  llmConfig,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
}) {
  return (
    <ConfigModal open={open} onClose={onClose} title="LLM Config">
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
          <Tooltip
            content="Configure available models"
            positioning={{ placement: "top" }}
            showArrow
          >
            <Link href="/settings/model-providers" target="_blank" asChild>
              <Button variant="ghost" size="sm">
                <Settings size={16} />
              </Button>
            </Link>
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
