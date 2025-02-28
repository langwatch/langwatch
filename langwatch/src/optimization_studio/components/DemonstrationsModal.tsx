import { type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../../components/ui/dialog";
import type { DatasetColumns } from "../../server/datasets/types";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, NodeDataset, Signature } from "../types/dsl";
import { fieldsToDatasetColumns } from "../utils/datasetUtils";
import { EditDataset } from "./datasets/EditDataset";

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

  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const columns = fieldsToDatasetColumns([
      ...(node.data.inputs ?? []),
      ...(node.data.outputs ?? []),
    ]);

    let demonstrations = (node.data as Signature).parameters?.find(
      (p) => p.identifier === "demonstrations"
    )?.value as NodeDataset | undefined;
    if (
      !demonstrations?.inline ||
      Object.keys(demonstrations.inline.records).length === 0
    ) {
      demonstrations = {
        inline: {
          records: Object.fromEntries(
            columns.map((column) => [column.name, []])
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
    setRendered(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { setNodeParameter } = useWorkflowStore(({ setNodeParameter }) => ({
    setNodeParameter,
  }));

  const setSelectedDataset = useCallback(
    (dataset: NodeDataset, _columnTypes: DatasetColumns, close: boolean) => {
      setNodeParameter(node.id, {
        identifier: "demonstrations",
        type: "dataset",
        value: dataset,
      });
      if (close) {
        onClose();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.data, node.id, setNodeParameter, onClose]
  );

  return (
    <Dialog.Root open={open} onOpenChange={({open}) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content
        marginX="32px"
        marginTop="32px"
        width="calc(100vw - 64px)"
        minHeight="0"
        height="calc(100vh - 64px)"
        borderRadius="8px"
        overflowY="auto"
      >
        <Dialog.CloseTrigger zIndex={10} />
        {rendered ? (
          <>
            <Dialog.Header></Dialog.Header>
            <Dialog.Body paddingBottom="32px">
              {open && editingDataset && (
                <EditDataset
                  editingDataset={editingDataset}
                  setEditingDataset={setEditingDataset}
                  setSelectedDataset={setSelectedDataset}
                  title="Demonstrations"
                  cta="Save"
                  hideButtons={true}
                  bottomSpace="268px"
                  loadingOverlayComponent={null}
                />
              )}
            </Dialog.Body>
          </>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
