import { Textarea } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Signature } from "../../types/dsl";
import { BasePropertiesPanel, PropertyField } from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";

export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { default_llm, setNode } = useWorkflowStore(
    ({ default_llm, setNode, setWorkflowSelected }) => ({
      default_llm,
      setNode,
      setWorkflowSelected,
    })
  );

  return (
    <BasePropertiesPanel node={node}>
      <PropertyField title="LLM">
        <LLMConfigField
          allowDefault={true}
          defaultLLMConfig={default_llm}
          llmConfig={node.data.llm}
          onChange={(llmConfig) => {
            setNode({
              id: node.id,
              data: {
                llm: llmConfig,
              },
            });
          }}
        />
      </PropertyField>
      <PropertyField title="Prompt">
        <Textarea
          fontFamily="monospace"
          fontSize={14}
          value={node.data.prompt ?? ""}
          onChange={(e) =>
            setNode({
              id: node.id,
              data: {
                ...node.data,
                prompt: e.target.value,
              },
            })
          }
        />
      </PropertyField>
    </BasePropertiesPanel>
  );
}
