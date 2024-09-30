import { Box, HStack, Text, Textarea, Tooltip, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import type { DatasetColumnType } from "../../../server/datasets/types";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Signature } from "../../types/dsl";
import {
  BasePropertiesPanel,
  PropertyField,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";
import { Info } from "react-feather";

export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { default_llm, setNode } = useWorkflowStore(
    ({ default_llm, setNode, setWorkflowSelected }) => ({
      default_llm,
      setNode,
      setWorkflowSelected,
    })
  );

  const { demonstrationRows, demonstrationColumns, total } = useMemo(() => {
    const allKeys = (node.data.inputs ?? [])
      .map((input) => input.identifier)
      .concat((node.data.outputs ?? []).map((output) => output.identifier))
      .concat(["id"]);
    const demonstrationRows =
      node.data.demonstrations?.map((demonstration, index) => {
        return {
          ...Object.fromEntries(
            Object.entries(demonstration).filter(([key]) =>
              allKeys.includes(key)
            )
          ),
          id: `${index}`,
        };
      }) ?? [];
    const presentKeys = new Set();
    demonstrationRows?.forEach((row) => {
      Object.entries(row).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          presentKeys.add(key);
        }
      });
    });
    const demonstrationColumns = Array.from(presentKeys)
      .filter((key) => key !== "id")
      .map((key) => ({
        name: key as string,
        type: "string" as DatasetColumnType,
      }));

    return {
      demonstrationRows,
      demonstrationColumns,
      total: demonstrationRows?.length,
    };
  }, [node.data.demonstrations, node.data.inputs, node.data.outputs]);

  return (
    <BasePropertiesPanel
      node={node}
      fieldsAfter={
        <>
          <VStack width="full" align="start" spacing={2}>
            <HStack>
              <PropertySectionTitle>
                Demonstrations{" "}
                {total > 0 && (
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
            </HStack>
            <DatasetPreview
              rows={demonstrationRows}
              columns={demonstrationColumns}
              minHeight={`${36 + 29 * (demonstrationRows?.length ?? 0)}px`}
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
