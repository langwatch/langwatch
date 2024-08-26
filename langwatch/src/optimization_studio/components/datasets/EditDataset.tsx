import { type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import {
  DatasetTable,
  type InMemoryDataset,
} from "../../../components/datasets/DatasetTable";
import type { DatasetColumnType } from "../../../server/datasets/types";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, Entry, Field } from "../../types/dsl";
import { transpostRowsFirstToColumnsFirstWithoutId } from "../../utils/datasetUtils";

export function EditDataset({
  node,
}: {
  node: NodeProps<Node<Component>> | Node<Component>;
}) {
  const { rows, columns } = useGetDatasetData(
    "dataset" in node.data ? node.data.dataset : undefined
  );

  const columnTypes = useMemo(() => {
    const fields = Object.fromEntries(
      (node.data.outputs ?? []).map((field) => [field.identifier, field.type])
    );

    const typeMap: Record<Field["type"], DatasetColumnType> = {
      str: "string",
      float: "number",
      int: "number",
      bool: "boolean",
      "list[str]": "json",
      "list[float]": "json",
      "list[int]": "json",
      "list[bool]": "json",
      signature: "json",
      llm: "json",
    };

    return Object.fromEntries(
      columns.map((column) => [
        column,
        (fields[column] ? typeMap[fields[column]] : "string") ?? "string",
      ])
    );
  }, [columns, node.data.outputs]);

  // Only update the datset from parent to child once the modal is open again
  const inMemoryDataset = useMemo(
    () => ({
      name: "dataset" in node.data ? node.data.dataset?.name : undefined,
      datasetRecords: rows ?? [],
      columnTypes: columnTypes ?? {},
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
          dataset: {
            ...(node.data as Entry).dataset,
            inline: transpostRowsFirstToColumnsFirstWithoutId(
              dataset.datasetRecords
            ),
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
