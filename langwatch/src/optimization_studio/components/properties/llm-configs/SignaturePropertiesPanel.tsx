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
import { DatasetPreview } from "../../../../components/datasets/DatasetPreview";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useGetDatasetData } from "../../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../../hooks/useWorkflowStore";
import type {
  ComponentType,
  LLMConfig,
  NodeDataset,
  Signature,
} from "../../../types/dsl";
import { DemonstrationsModal } from "../../DemonstrationsModal";
import {
  BasePropertiesPanel,
  PropertyField,
  PropertySectionTitle,
} from "../BasePropertiesPanel";
import { LLMConfigField } from "../modals/llm-config/LLMConfigField";
import { ComponentIcon } from "../../ColorfulBlockIcons";
import { PromptSource } from "./PromptSource";
import { PromptConfigForm } from "~/prompt-configs/forms/PromptConfigForm";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { llmConfigToNodeData } from "~/optimization_studio/utils/registryUtils";
import type { LatestConfigVersionSchema } from "~/server/repositories/llm-config-version-schema";

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
  const { project } = useOrganizationTeamProject();
  const { setNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
  }));

  const parameters = node.data.parameters
    ? Object.fromEntries(node.data.parameters.map((p) => [p.identifier, p]))
    : {};

  // Figure this out and how to handle it
  const {
    rows: demonstrationRows,
    columns: demonstrationColumns,
    total,
  } = useGetDatasetData({
    dataset: parameters.demonstrations?.value as NodeDataset | undefined,
    preview: true,
  });

  const { data: config, refetch } = api.llmConfigs.getPromptConfigById.useQuery(
    {
      id: node.data.configId,
      projectId: project?.id ?? "",
    }
  );

  const handleSubmitSuccess = async () => {
    const latestConfig = await refetch();

    setNode({
      ...node,
      data: llmConfigToNodeData(
        latestConfig.data as any,
        latestConfig.data?.versions[0] as any
      ),
    });

    if (!project?.id) {
      throw new Error("Project ID is required");
    }

    console.log("latest", config);
  };

  return (
    <BasePropertiesPanel node={node} hideParameters>
      <PromptSource configId="" onSelect={console.log} />
      {/* TODO: What's this? */}
      {(parameters.prompting_technique?.value as { ref: string }) && (
        <PromptingTechniqueField
          value={(parameters.prompting_technique?.value as { ref: string }).ref}
        />
      )}
      <PromptConfigForm
        configId={node.data.configId}
        onSubmitSuccess={() => {
          void handleSubmitSuccess();
        }}
      />
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
