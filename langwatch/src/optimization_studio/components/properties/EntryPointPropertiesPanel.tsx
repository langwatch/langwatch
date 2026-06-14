import {
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useState } from "react";
import { ArrowRight, Database, Flag, Folder, X } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { type Variable, VariablesSection } from "~/components/variables";
import { Tooltip } from "../../../components/ui/tooltip";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Entry, Field } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import {
  BasePropertiesPanel,
  PropertySectionTitle,
} from "./BasePropertiesPanel";

/**
 * Drawer for the workflow's entry point.
 *
 * The fields here are the workflow's INPUTS - user-owned and editable.
 * A dataset is an optional attachment that seeds those inputs with its
 * columns (merge + dedup, see attachEntryDataset) and provides the rows
 * for evaluations; it is rendered as a compact card, not a data grid,
 * so it never reads as "the inputs".
 */
export function EntryPointPropertiesPanel({ node }: { node: Node<Entry> }) {
  const { open, onOpen, onClose } = useDisclosure();
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();
  const { total } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: true,
  });
  const { setNode, setSelectedNode, endNodeId } = useWorkflowStore(
    useShallow((state) => ({
      setNode: state.setNode,
      setSelectedNode: state.setSelectedNode,
      endNodeId: state.nodes.find((n) => n.type === "end")?.id,
    })),
  );

  const updateNodeInternals = useUpdateNodeInternals();

  const dataset = node.data.dataset;

  // The entry fields are the workflow inputs. DSL-wise they live on the node's
  // `outputs` (they are emitted to downstream nodes); the user-facing language
  // is "Inputs". They are the source of the run, so there is nothing to map.
  const inputVariables: Variable[] = (node.data.outputs ?? []).map((field) => ({
    identifier: field.identifier,
    type: field.type,
  }));

  const handleInputsChange = useCallback(
    (newVariables: Variable[]) => {
      const existing = node.data.outputs ?? [];
      const outputs: Field[] = newVariables.map((variable) => {
        const prev = existing.find((f) => f.identifier === variable.identifier);
        return {
          ...(prev ?? {}),
          identifier: variable.identifier,
          type: variable.type as Field["type"],
        };
      });
      // Send only the changed field; setNode merges data shallowly, so an
      // attached dataset and other entry config survive untouched.
      setNode({ id: node.id, data: { outputs } });
      updateNodeInternals(node.id);
    },
    [node.id, node.data.outputs, setNode, updateNodeInternals],
  );

  const detachDataset = useCallback(() => {
    setNode({
      id: node.id,
      data: { ...node.data, dataset: undefined },
    });
  }, [setNode, node.id, node.data]);

  const goToEndNode = useCallback(() => {
    if (endNodeId) {
      setSelectedNode(endNodeId);
    }
  }, [endNodeId, setSelectedNode]);

  return (
    <BasePropertiesPanel node={node} hideOutputs hideInputs hideParameters>
      <VariablesSection
        variables={inputVariables}
        onChange={handleInputsChange}
        showMappings={false}
        isMappingDisabled={true}
        canAddRemove={true}
        readOnly={false}
        title="Inputs"
      />

      <VStack width="full" align="start">
        <HStack width="full">
          <PropertySectionTitle>Attached Dataset</PropertySectionTitle>
          <Spacer />
          {!dataset && (
            <Button
              size="xs"
              variant="ghost"
              marginBottom={-1}
              data-testid="attach-dataset-button"
              onClick={() => {
                setEditingDataset(undefined);
                onOpen();
              }}
            >
              <Folder size={14} />
              <Text>Attach...</Text>
            </Button>
          )}
        </HStack>
        {dataset ? (
          <HStack
            width="full"
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            border="1px solid"
            borderColor="border"
            data-testid="entry-dataset-card"
          >
            <Database size={14} style={{ flexShrink: 0 }} />
            <Text fontSize="13px" truncate>
              {dataset.name ?? "Dataset"}
            </Text>
            {total !== undefined && total !== null && (
              <Text fontSize="13px" color="fg.subtle" flexShrink={0}>
                ({total} {total === 1 ? "row" : "rows"})
              </Text>
            )}
            <Spacer />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setEditingDataset(node.data.dataset);
                onOpen();
              }}
            >
              Open
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setEditingDataset(undefined);
                onOpen();
              }}
            >
              Replace
            </Button>
            <Tooltip content="Detach dataset (inputs are kept)">
              <Button
                size="xs"
                variant="ghost"
                data-testid="detach-dataset-button"
                onClick={detachDataset}
              >
                <X size={14} />
              </Button>
            </Tooltip>
          </HStack>
        ) : (
          <Text fontSize="13px" color="fg.muted">
            Optional. Attaching a dataset adds its columns to the inputs and
            provides the rows for evaluations.
          </Text>
        )}
      </VStack>
      <DatasetModal
        open={open}
        onClose={onClose}
        node={node}
        editingDataset={editingDataset}
      />
      {endNodeId && (
        <VStack
          align="start"
          gap={2}
          width="full"
          border="1px solid"
          borderColor="border"
          borderRadius="md"
          padding={3}
        >
          <Text fontSize="13px" color="fg.muted">
            Define the outputs for this workflow
          </Text>
          <Button
            size="sm"
            variant="outline"
            width="full"
            data-testid="go-to-end-node"
            onClick={goToEndNode}
          >
            <Flag size={14} />
            <Text>Go to end node</Text>
            <Spacer />
            <ArrowRight size={14} />
          </Button>
        </VStack>
      )}
    </BasePropertiesPanel>
  );
}
