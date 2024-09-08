import {
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useState } from "react";
import { Folder, Link2 } from "react-feather";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Component, Entry, Signature } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import {
  BasePropertiesPanel,
  PropertyField,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";

export function SignaturePropertiesPanel({ node }: { node: Node<Signature> }) {
  const { default_llm, setNode, setWorkflowSelected } = useWorkflowStore(
    ({ default_llm, setNode, setWorkflowSelected }) => ({
      default_llm,
      setNode,
      setWorkflowSelected,
    })
  );

  return (
    <BasePropertiesPanel node={node}>
      <VStack align="start" spacing={3} width="full">
        <HStack width="full" paddingRight={2}>
          <PropertySectionTitle>LLM</PropertySectionTitle>
          <Spacer />
        </HStack>
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
      </VStack>
    </BasePropertiesPanel>
  );
}
