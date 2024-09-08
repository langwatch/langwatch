import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { Sliders2 } from "../../../components/icons/Sliders2";
import {
  modelSelectorOptions,
  useModelSelectionOptions,
} from "../../../components/ModelSelector";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { BasePropertiesPanel, PropertyField } from "./BasePropertiesPanel";
import { LLMConfigModal } from "./LLMConfigModal";

export function WorkflowPropertiesPanel() {
  const { getWorkflow, setWorkflow } = useWorkflowStore(
    ({ getWorkflow, setWorkflow }) => ({
      getWorkflow,
      setWorkflow,
    })
  );

  const workflow = getWorkflow();

  const reactflowBg = `<svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="6" height="6" fill="#F2F4F8"/>
<rect x="3" y="3" width="2" height="2" fill="#E5E7EB"/>
</svg>
`;
  const { modelOption } = useModelSelectionOptions(
    modelSelectorOptions.map((option) => option.value),
    workflow.default_llm.model,
    "chat"
  );
  const { isOpen, onClose, onToggle } = useDisclosure();

  return (
    <BasePropertiesPanel
      node={workflow}
      header={
        <>
          <Box
            background={`url('data:image/svg+xml;utf8,${encodeURIComponent(
              reactflowBg
            )}')`}
            borderRadius="4px"
            border="1px solid"
            borderColor="gray.200"
            width="32px"
            height="32px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="white"
          />
          <Text fontSize={16} fontWeight={500}>
            {workflow.name}
          </Text>
        </>
      }
    >
      <PropertyField title="Default LLM">
        <LLMConfigModal
          isOpen={isOpen}
          onClose={onClose}
          llmConfig={workflow.default_llm}
          onChange={(llmConfig) => {
            setWorkflow({ default_llm: llmConfig });
          }}
        />
        <HStack spacing={2} paddingX={2} width="full" align="center">
          <Box width="14px">{modelOption?.icon}</Box>
          <Box fontSize={14} fontFamily="mono" noOfLines={1}>
            {modelOption?.label}
          </Box>
          {(!!modelOption?.version || modelOption?.isDisabled) && (
            <Text fontSize={14} fontFamily="mono" color="gray.400">
              ({modelOption?.value ? modelOption?.version : "disabled"})
            </Text>
          )}
          <Spacer />
          <Button size="sm" variant="ghost" onClick={onToggle}>
            <Sliders2 size={16} />
          </Button>
        </HStack>
      </PropertyField>
    </BasePropertiesPanel>
  );
}
