import { type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import {
  DatasetTable,
  type InMemoryDataset,
} from "../../../components/datasets/DatasetTable";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Entry } from "../../types/dsl";
import {
  datasetColumnsToFieldTypes,
  transpostRowsFirstToColumnsFirstWithoutId,
} from "../../utils/datasetUtils";

export function EditDataset({
  node,
}: {
  node: NodeProps<Node<Entry>> | Node<Entry>;
}) {
  const { rows, columns, query } = useGetDatasetData({
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
    [columns, node.data, rows]
  );

  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const onUpdateDataset = useCallback(
    (dataset: InMemoryDataset & { datasetId?: string }) => {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          outputs: datasetColumnsToFieldTypes(dataset.columnTypes),
          dataset: dataset.datasetId
            ? {
                id: dataset.datasetId,
                name: dataset.name,
              }
            : {
                name: dataset.name,
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

  useEffect(() => {
    // Once this component is unmounted, refetch the dataset to update the database-saved dataset previews all over
    return () => {
      void query.refetch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DatasetTable
      datasetId={node.data.dataset?.id}
      inMemoryDataset={inMemoryDataset}
      onUpdateDataset={onUpdateDataset}
      isEmbedded={true}
    />
  );
}
