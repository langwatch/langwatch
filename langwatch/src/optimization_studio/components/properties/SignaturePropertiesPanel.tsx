import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { Edit2, Info, X } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { Tooltip } from "../../../components/ui/tooltip";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type {
  ComponentType,
  LLMConfig,
  NodeDataset,
  Signature,
} from "../../types/dsl";
import { DemonstrationsModal } from "../DemonstrationsModal";
import {
  BasePropertiesPanel,
  PropertyField,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/llm-config/LLMConfigField";
import { ComponentIcon } from "../ColorfulBlockIcons";

/**
 * Properties panel for the Signature node in the optimization studio.
 *
 * A Signature in this context is based on the DSPy concept, which defines
 * an interface for LLM interactions with inputs, outputs, and parameters.
 *
 * This panel allows users to configure:
 * - The LLM model to use for this signature
 * - Instructions for the LLM
 * - Demonstrations (few-shot examples)
 * - Prompting techniques (like Chain of Thought)
 *
 * The Signature node represents an LLM calling component in the workflow
 * that can be connected with other nodes to build complex LLM-powered applications.
 */
export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { default_llm, setNodeParameter } = useWorkflowStore(
    ({ default_llm, setNodeParameter, setWorkflowSelected }) => ({
      default_llm,
      setNodeParameter,
      setWorkflowSelected,
    })
  );

  const parameters = node.data.parameters
    ? Object.fromEntries(node.data.parameters.map((p) => [p.identifier, p]))
    : {};

  const { open, onOpen, onClose } = useDisclosure();
  const {
    rows: demonstrationRows,
    columns: demonstrationColumns,
    total,
  } = useGetDatasetData({
    dataset: parameters.demonstrations?.value as NodeDataset | undefined,
    preview: true,
  });

  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      fieldsAfter={
        <>
          <VStack width="full" align="start" gap={2}>
            <HStack width="full">
              <PropertySectionTitle>
                Demonstrations{" "}
                {total !== undefined && total > 0 && (
                  <Text as="span" color="gray.400">
                    ({total} rows)
                  </Text>
                )}
              </PropertySectionTitle>
              <Tooltip content="Few-shot examples to guide the LLM to generate the correct output.">
                <Box paddingTop={1}>
                  <Info size={14} />
                </Box>
              </Tooltip>
              <Spacer />
              <Button
                size="xs"
                variant="ghost"
                marginBottom={-1}
                onClick={() => {
                  onOpen();
                }}
              >
                <Edit2 size={14} />
                <Text>Edit</Text>
              </Button>
            </HStack>
            <DatasetPreview
              rows={demonstrationRows}
              columns={demonstrationColumns}
              minHeight={`${36 + 29 * (demonstrationRows?.length ?? 0)}px`}
            />
            <DemonstrationsModal open={open} onClose={onClose} node={node} />
          </VStack>
        </>
      }
    >
      {(parameters.prompting_technique?.value as { ref: string }) && (
        <PromptingTechniqueField
          value={(parameters.prompting_technique?.value as { ref: string }).ref}
        />
      )}
      <PropertyField title="LLM">
        <LLMConfigField
          allowDefault={true}
          defaultLLMConfig={default_llm}
          llmConfig={parameters.llm?.value as LLMConfig | undefined}
          onChange={(llmConfig) => {
            setNodeParameter(node.id, {
              identifier: "llm",
              type: "llm",
              value: llmConfig,
            });
          }}
        />
      </PropertyField>
      <PropertyField title="Instructions">
        <Textarea
          height="100px"
          fontFamily="monospace"
          fontSize="13px"
          value={(parameters.instructions?.value as string | undefined) ?? ""}
          onChange={(e) =>
            setNodeParameter(node.id, {
              identifier: "instructions",
              type: "str",
              value: e.target.value,
            })
          }
        />
      </PropertyField>
    </BasePropertiesPanel>
  );
}

function PromptingTechniqueField({ value }: { value: string | undefined }) {
  const {
    node: promptingTechniqueNode,
    deleteNode,
    setSelectedNode,
    deselectAllNodes,
  } = useWorkflowStore((state) => ({
    node: state.nodes.find((n) => n.id === value),
    deleteNode: state.deleteNode,
    setSelectedNode: state.setSelectedNode,
    deselectAllNodes: state.deselectAllNodes,
  }));

  if (!promptingTechniqueNode) {
    return null;
  }

  return (
    <PropertyField title="Prompting Technique">
      <HStack
        gap={2}
        width="full"
        paddingX={3}
        paddingY={2}
        background="gray.100"
        borderRadius="8px"
        cursor="pointer"
        role="button"
        onClick={() => {
          deselectAllNodes();
          setSelectedNode(promptingTechniqueNode.id);
        }}
      >
        <ComponentIcon
          type={promptingTechniqueNode.type as ComponentType}
          cls={promptingTechniqueNode.data.cls}
          size="md"
        />
        <Text fontSize="13px" fontWeight={500}>
          {promptingTechniqueNode.data.cls}
        </Text>
        <Spacer />
        <Button
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            deleteNode(promptingTechniqueNode.id);
          }}
        >
          <X size={14} />
        </Button>
      </HStack>
    </PropertyField>
  );
}
