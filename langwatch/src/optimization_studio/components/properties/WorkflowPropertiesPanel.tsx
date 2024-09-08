import { Box, Text } from "@chakra-ui/react";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { BasePropertiesPanel, PropertyField } from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";

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
