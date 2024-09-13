import { Box, Text, useDisclosure } from "@chakra-ui/react";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { BasePropertiesPanel, PropertyField } from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";
import { WorkflowIcon } from "../ColorfulBlockIcons";
import { EmojiPickerModal } from "./modals/EmojiPickerModal";

export function WorkflowPropertiesPanel() {
  const { getWorkflow, setWorkflow } = useWorkflowStore(
    ({ getWorkflow, setWorkflow }) => ({
      getWorkflow,
      setWorkflow,
    })
  );

  const workflow = getWorkflow();

  const { isOpen, onClose, onToggle } = useDisclosure();

  return (
    <BasePropertiesPanel
      node={workflow}
      header={
        <>
          <EmojiPickerModal
            isOpen={isOpen}
            onClose={onClose}
            onChange={(emoji) => {
              setWorkflow({ icon: emoji });
            }}
          />
          <Box role="button" cursor="pointer" onClick={onToggle}>
            <WorkflowIcon icon={workflow.icon} size="lg" />
          </Box>
          <Text fontSize={16} fontWeight={500}>
            {workflow.name}
          </Text>
        </>
      }
    >
      <PropertyField title="Default LLM">
        <LLMConfigField
          llmConfig={workflow.default_llm}
          onChange={(llmConfig) => {
            setWorkflow({ default_llm: llmConfig });
          }}
        />
      </PropertyField>
    </BasePropertiesPanel>
  );
}
