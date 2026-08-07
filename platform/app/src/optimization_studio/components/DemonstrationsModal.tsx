/**
 * Demonstrations editor for signature (prompt) nodes in the studio; hosts
 * the shared dataset editor in in-memory mode; rows live in the node's
 * `demonstrations` parameter and every change writes back into the DSL.
 */
import { Box, Button, Heading } from "@chakra-ui/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { DatasetEditorTable } from "~/components/datasets/editor/DatasetEditorTable";
import { Dialog } from "../../components/ui/dialog";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, NodeDataset, Signature } from "../types/dsl";
import {
  fieldsToDatasetColumns,
  inMemoryDatasetToNodeDataset,
  transposeColumnsFirstToRowsFirstWithId,
} from "../utils/datasetUtils";

export function DemonstrationsModal({
  open,
  onClose,
  node,
}: {
  open: boolean;
  onClose: () => void;
  node: NodeProps<Node<Component>> | Node<Component>;
}) {
  const [editingDataset, setEditingDataset] = useState<
    NodeDataset | undefined
  >();
  const editorPortalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const columns = fieldsToDatasetColumns([
      ...(node.data.inputs ?? []),
      ...(node.data.outputs ?? []),
    ]);

    let demonstrations = (node.data as Signature).parameters?.find(
      (p) => p.identifier === "demonstrations",
    )?.value as NodeDataset | undefined;
    if (
      !demonstrations?.inline ||
      Object.keys(demonstrations.inline.records).length === 0
    ) {
      demonstrations = {
        inline: {
          records: Object.fromEntries(
            columns.map((column) => [column.name, []]),
          ),
          columnTypes: columns,
        },
      };
    }
    demonstrations = {
      ...demonstrations,
      inline: {
        ...demonstrations.inline,
        columnTypes: columns,
      } as NodeDataset["inline"],
    };

    setEditingDataset(open ? demonstrations : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { setNodeParameter } = useWorkflowStore(({ setNodeParameter }) => ({
    setNodeParameter,
  }));

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content
        bg="bg"
        marginX="32px"
        marginTop="32px"
        width="calc(100vw - 64px)"
        minHeight="0"
        height="calc(100vh - 64px)"
        borderRadius="8px"
        overflowY="auto"
      >
        <Dialog.CloseTrigger zIndex={10} />
        <Dialog.Header>
          <Heading size="md">Edit Demonstrations</Heading>
        </Dialog.Header>
        <Dialog.Body paddingBottom="16px">
          <Box ref={editorPortalRef} width="full" height="full">
            {open && editingDataset?.inline && (
              <DatasetEditorTable
                title="Demonstrations"
                hideButtons
                editorPortalRef={editorPortalRef}
                inMemoryDataset={{
                  name: "Demonstrations",
                  columnTypes: editingDataset.inline.columnTypes,
                  datasetRecords: transposeColumnsFirstToRowsFirstWithId(
                    editingDataset.inline.records,
                  ),
                }}
                onUpdateDataset={(dataset) => {
                  setNodeParameter(node.id, {
                    identifier: "demonstrations",
                    type: "dataset",
                    value: inMemoryDatasetToNodeDataset(dataset),
                  });
                }}
              />
            )}
          </Box>
        </Dialog.Body>
        <Dialog.Footer>
          <Button colorPalette="blue" onClick={onClose}>
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
