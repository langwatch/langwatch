import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useState } from "react";
import { ArrowRight, Database, Folder, Info, X } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { Tooltip } from "../../../components/ui/tooltip";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Entry } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import {
  BasePropertiesPanel,
  FieldsDefinition,
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

  const dataset = node.data.dataset;

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
    <BasePropertiesPanel
      node={node}
      hideOutputs
      hideInputs
      hideParameters
    >
      {/* The entry fields are the workflow inputs - fully editable.
          DSL-wise they live on the node's `outputs` (they're emitted to
          downstream nodes), the user-facing language is "Inputs". */}
      <FieldsDefinition node={node} title="Inputs" field="outputs" />

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
            Optional. Attaching a dataset adds its columns to the inputs
            and provides the rows for evaluations.
          </Text>
        )}
      </VStack>
      <DatasetModal
        open={open}
        onClose={onClose}
        node={node}
        editingDataset={editingDataset}
      />
      {dataset && (
        <VStack width="full" align="start">
          <HStack width="full">
            <PropertySectionTitle>Manual Test Entry</PropertySectionTitle>
            <Tooltip content="When manually running the full workflow, a single entry from the dataset will be used, choose which one to pick.">
              <Box paddingTop={1}>
                <Info size={14} />
              </Box>
            </Tooltip>
          </HStack>
          <VStack width="full" align="start" gap={2}>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={
                  typeof node.data.entry_selection === "number"
                    ? "specific"
                    : node.data.entry_selection
                }
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const value = e.target.value;
                  setNode({
                    id: node.id,
                    data: {
                      ...node.data,
                      entry_selection: value === "specific" ? 0 : value,
                    },
                  });
                }}
              >
                <option value="first">First</option>
                <option value="last">Last</option>
                <option value="random">Random</option>
                <option value="specific">Specific Row ID</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            {typeof node.data.entry_selection === "number" && (
              <Field.Root width="full">
                <Input
                  type="number"
                  size="sm"
                  min={0}
                  value={node.data.entry_selection}
                  onChange={(e) => {
                    const value = e.target.value
                      ? parseInt(e.target.value, 10)
                      : 0;
                    setNode({
                      id: node.id,
                      data: {
                        ...node.data,
                        entry_selection: value,
                      },
                    });
                  }}
                  placeholder="Enter row ID"
                />
              </Field.Root>
            )}
          </VStack>
        </VStack>
      )}
      {endNodeId && (
        <HStack width="full">
          <Spacer />
          <Button
            size="xs"
            variant="ghost"
            data-testid="go-to-end-node"
            onClick={goToEndNode}
          >
            <Text>End node</Text>
            <ArrowRight size={14} />
          </Button>
        </HStack>
      )}
    </BasePropertiesPanel>
  );
}
