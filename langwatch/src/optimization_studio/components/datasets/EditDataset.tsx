import { type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import {
  DatasetTable,
  type InMemoryDataset,
} from "../../../components/datasets/DatasetTable";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, Entry } from "../../types/dsl";
import {
  datasetColumnsToFieldTypes,
  transpostRowsFirstToColumnsFirstWithoutId,
} from "../../utils/datasetUtils";

export function EditDataset({
  node,
}: {
  node: NodeProps<Node<Component>> | Node<Component>;
}) {
  const { rows, columns } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: false,
  });

  // Only update the datset from parent to child once the modal is open again
  const inMemoryDataset = useMemo(
    () => ({
      name: "dataset" in node.data ? node.data.dataset?.name : undefined,
      datasetRecords: rows ?? [],
      columnTypes: columns ?? [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const onUpdateDataset = useCallback(
    (dataset: InMemoryDataset) => {
      setNode({
        id: node.id,
        data: {
          ...(node.data as Entry),
          outputs: datasetColumnsToFieldTypes(dataset.columnTypes),
          dataset: {
            ...(node.data as Entry).dataset,
            inline: {
              records: transpostRowsFirstToColumnsFirstWithoutId(
                dataset.datasetRecords
              ),
              columnTypes: dataset.columnTypes,
            },
          },
        } as Entry,
      });
    },
    [node.data, node.id, setNode]
  );

  return (
    <DatasetTable
      inMemoryDataset={inMemoryDataset}
      onUpdateDataset={onUpdateDataset}
      isEmbedded={true}
    />
  );
}
