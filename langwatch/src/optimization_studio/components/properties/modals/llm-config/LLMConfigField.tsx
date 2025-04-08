import { Box, Button, HStack, Spacer } from "@chakra-ui/react";
import { X } from "react-feather";
import { Sliders2 } from "../../../../../components/icons/Sliders2";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "../../../../../components/ModelSelector";
import type { LLMConfig } from "../../../../types/dsl";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../../../../hooks/useWorkflowStore";
import { AddModelProviderKey } from "../../../AddModelProviderKey";
import { Tooltip } from "../../../../../components/ui/tooltip";
import { useDisclosure } from "@chakra-ui/react";
import { LLMConfigModal } from "./LLMConfigModal";
import { LLMModelDisplay } from "./LLMModelDisplay";

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
