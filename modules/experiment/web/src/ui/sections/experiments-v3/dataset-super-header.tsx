import { Skeleton, Text } from "@chakra-ui/react";
import { Database } from "lucide-react";
import React from "react";

import type { DatasetReference } from "../../../model/experiments-v3/types.ts";
import { DatasetTabs } from "./DatasetSection/dataset-tabs.tsx";
import { SuperHeader } from "../../elements/experiments-v3/super-header.tsx";

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

/** The dataset title, as a skeleton while loading and as plain text otherwise. */
function DatasetLabel() {
  return (
    <Text fontWeight="semibold" fontSize="sm" color="fg">
      Dataset
    </Text>
  );
}

/** Either the tabs for the active dataset or the bare title. */
function DatasetSuperHeaderBody({
  activeDataset,
  datasetHandlers,
  isLoading,
}: Pick<DatasetSuperHeaderProps, "activeDataset" | "datasetHandlers" | "isLoading">) {
  if (isLoading) {
    return (
      <>
        <DatasetLabel />
        <Skeleton height="20px" width="150px" />
      </>
    );
  }
  if (activeDataset && datasetHandlers) {
    return (
      <DatasetTabs
        onSelectExisting={datasetHandlers.onSelectExisting}
        onUploadCSV={datasetHandlers.onUploadCSV}
        onEditDataset={datasetHandlers.onEditDataset}
        onSaveAsDataset={datasetHandlers.onSaveAsDataset}
      />
    );
  }

  return <DatasetLabel />;
}

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
      <DatasetSuperHeaderBody
        activeDataset={activeDataset}
        datasetHandlers={datasetHandlers}
        isLoading={isLoading}
      />
    </SuperHeader>
  );
});
