import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DatasetTable,
  type InMemoryDataset,
} from "../../../components/datasets/DatasetTable";
import type { DatasetColumns } from "../../../server/datasets/types";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Entry } from "../../types/dsl";
import { inMemoryDatasetToNodeDataset } from "../../utils/datasetUtils";
import { Box, Button } from "@chakra-ui/react";

export function EditDataset({
  editingDataset,
  setEditingDataset,
  setSelectedDataset,
  title,
  cta,
  hideButtons = false,
  bottomSpace,
  loadingOverlayComponent,
}: {
  editingDataset: Required<Entry>["dataset"];
  setEditingDataset: (dataset: Entry["dataset"]) => void;
  setSelectedDataset: (
    dataset: Required<Entry>["dataset"],
    columnTypes: DatasetColumns,
    close: boolean
  ) => void;
  title?: string;
  cta?: string;
  hideButtons?: boolean;
  bottomSpace?: string;
  loadingOverlayComponent?: (() => React.ReactNode) | null;
}) {
  const { rows, columns, query } = useGetDatasetData({
    dataset: editingDataset,
    preview: false,
  });

  // Only update the datset from parent to child once the modal is open again
  const inMemoryDataset = useMemo(
    () => ({
      name: editingDataset?.name,
      datasetRecords: rows ?? [],
      columnTypes: columns ?? [],
    }),
    [columns, editingDataset, rows]
  );

  const [columnTypes, setColumnTypes] = useState<DatasetColumns>(columns ?? []);

  useEffect(() => {
    if (columns.length > 0) {
      setColumnTypes(columns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(columns)]);

  const onUpdateDataset = useCallback(
    (dataset: InMemoryDataset) => {
      const nodeDataset = inMemoryDatasetToNodeDataset(dataset);

      setColumnTypes(dataset.columnTypes);
      setEditingDataset(nodeDataset);
      if (nodeDataset) {
        setSelectedDataset(nodeDataset, dataset.columnTypes, false);
      }
    },
    [setEditingDataset, setSelectedDataset]
  );

  useEffect(() => {
    // Once this component is unmounted, refetch the dataset to update the database-saved dataset previews all over
    return () => {
      void query.refetch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box position="relative">
      <DatasetTable
        datasetId={editingDataset.id}
        inMemoryDataset={inMemoryDataset}
        onUpdateDataset={onUpdateDataset}
        isEmbedded={true}
        title={title}
        hideButtons={hideButtons}
        bottomSpace={bottomSpace}
        loadingOverlayComponent={loadingOverlayComponent}
      />
      <Button
        colorScheme="blue"
        position="absolute"
        bottom="0"
        right="24px"
        onClick={() => {
          setSelectedDataset(editingDataset, columnTypes, true);
        }}
      >
        {cta ?? "Done"}
      </Button>
    </Box>
  );
}
