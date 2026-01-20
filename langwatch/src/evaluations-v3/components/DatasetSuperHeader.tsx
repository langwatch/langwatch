import { Skeleton, Text } from "@chakra-ui/react";
import { Database } from "lucide-react";

import type { DatasetReference } from "../types";
import { DatasetTabs } from "./DatasetSection/DatasetTabs";
import { SuperHeader } from "./SuperHeader";

export type DatasetHandlers = {
  onSelectExisting: () => void;
  onUploadCSV: () => void;
  onEditDataset: () => void;
  onSaveAsDataset: (dataset: DatasetReference) => void;
};

type DatasetSuperHeaderProps = {
  colSpan: number;
  activeDataset?: DatasetReference;
  datasetHandlers?: DatasetHandlers;
  isLoading?: boolean;
};

/**
 * Super header for the dataset columns section.
 */
export function DatasetSuperHeader({
  colSpan,
  activeDataset,
  datasetHandlers,
  isLoading,
}: DatasetSuperHeaderProps) {
  return (
    <SuperHeader
      colSpan={colSpan}
      color="blue.400"
      icon={<Database size={14} />}
      paddingLeft="52px"
    >
      {isLoading ? (
        <>
          <Text fontWeight="semibold" fontSize="sm" color="gray.700">
            Dataset
          </Text>
          <Skeleton height="20px" width="150px" />
        </>
      ) : activeDataset && datasetHandlers ? (
        <DatasetTabs
          onSelectExisting={datasetHandlers.onSelectExisting}
          onUploadCSV={datasetHandlers.onUploadCSV}
          onEditDataset={datasetHandlers.onEditDataset}
          onSaveAsDataset={datasetHandlers.onSaveAsDataset}
        />
      ) : (
        <Text fontWeight="semibold" fontSize="sm" color="gray.700">
          Dataset
        </Text>
      )}
    </SuperHeader>
  );
}
