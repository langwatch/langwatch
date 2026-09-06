import { Skeleton, Text } from "@chakra-ui/react";
import { Database } from "lucide-react";
import React from "react";

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
 * Memoized to prevent unnecessary re-renders on scroll.
 */
export const DatasetSuperHeader = React.memo(function DatasetSuperHeader({
  colSpan,
  activeDataset,
  datasetHandlers,
  isLoading,
}: DatasetSuperHeaderProps) {
  return (
    <SuperHeader
      colSpan={colSpan}
      color="blue.emphasized"
      icon={<Database size={14} />}
      paddingLeft="52px"
    >
      {isLoading ? (
        <>
          <Text fontWeight="semibold" fontSize="sm" color="fg">
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
        <Text fontWeight="semibold" fontSize="sm" color="fg">
          Dataset
        </Text>
      )}
    </SuperHeader>
  );
});
