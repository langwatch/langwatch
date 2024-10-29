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
import { Edit2, Info } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Signature } from "../../types/dsl";
import { DemonstrationsModal } from "../DemonstrationsModal";
import {
  BasePropertiesPanel,
  PropertyField,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";

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
      hideProperties
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
