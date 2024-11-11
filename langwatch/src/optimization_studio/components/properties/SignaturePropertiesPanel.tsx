import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  Textarea,
  Tooltip,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { Edit2, Info, X } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { ComponentType, Signature } from "../../types/dsl";
import { DemonstrationsModal } from "../DemonstrationsModal";
import {
  BasePropertiesPanel,
  PropertyField,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";
import { ComponentIcon } from "../ColorfulBlockIcons";

export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { default_llm, setNode } = useWorkflowStore(
    ({ default_llm, setNode, setWorkflowSelected }) => ({
      default_llm,
      setNode,
      setWorkflowSelected,
    })
  );

  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    rows: demonstrationRows,
    columns: demonstrationColumns,
    total,
  } = useGetDatasetData({
    dataset: node.data.demonstrations,
    preview: true,
  });

  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      fieldsAfter={
        <>
          <VStack width="full" align="start" spacing={2}>
            <HStack width="full">
              <PropertySectionTitle>
                Demonstrations{" "}
                {total !== undefined && total > 0 && (
                  <Text as="span" color="gray.400">
                    ({total} rows)
                  </Text>
                )}
              </PropertySectionTitle>
              <Tooltip label="Few-shot examples to guide the LLM to generate the correct output.">
                <Box paddingTop={1}>
                  <Info size={14} />
                </Box>
              </Tooltip>
              <Spacer />
              <Button
                size="xs"
                variant="ghost"
                marginBottom={-1}
                leftIcon={<Edit2 size={14} />}
                onClick={() => {
                  onOpen();
                }}
              >
                <Text>Edit</Text>
              </Button>
            </HStack>
            <DatasetPreview
              rows={demonstrationRows}
              columns={demonstrationColumns}
              minHeight={`${36 + 29 * (demonstrationRows?.length ?? 0)}px`}
            />
            <DemonstrationsModal
              isOpen={isOpen}
              onClose={onClose}
              node={node}
            />
          </VStack>
        </>
      }
    >
      {node.data.decorated_by && <PromptingTechniqueField node={node} />}
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
          fontSize={13}
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

function PromptingTechniqueField({ node }: { node: Node<Signature> }) {
  const {
    node: promptingTechniqueNode,
    deleteNode,
    setSelectedNode,
    deselectAllNodes,
    propertiesExpanded,
    setPropertiesExpanded,
  } = useWorkflowStore((state) => ({
    node: state.nodes.find((n) => n.id === node.data.decorated_by?.ref),
    deleteNode: state.deleteNode,
    setSelectedNode: state.setSelectedNode,
    deselectAllNodes: state.deselectAllNodes,
    propertiesExpanded: state.propertiesExpanded,
    setPropertiesExpanded: state.setPropertiesExpanded,
  }));

  if (!promptingTechniqueNode) {
    return null;
  }

  return (
    <PropertyField title="Prompting Technique">
      <HStack
        spacing={2}
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
        <Text fontSize={13} fontWeight={500}>
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
