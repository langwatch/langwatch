import {
  DatasetPreviewTable as DatasetPreviewTableView,
  type DatasetPreviewTableProps,
} from "@langwatch/dataset-browser-kit";
import { ExternalImage, getImageUrl } from "@langwatch/design-system/external-image";
import type { ReactNode } from "react";

const renderImage = (value: string): ReactNode | null => {
  const imageUrl = getImageUrl(value);
  if (!imageUrl) {
    return null;
  }

  return (
    <ExternalImage
      src={imageUrl}
      minWidth="24px"
      minHeight="24px"
      maxHeight="80px"
      maxWidth="100%"
      expandable
    />
  );
};

export function DatasetPreviewTable(props: DatasetPreviewTableProps) {
  return <DatasetPreviewTableView {...props} renderImage={renderImage} />;
}
