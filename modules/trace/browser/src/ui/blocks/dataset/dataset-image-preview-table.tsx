import { ExternalImage, getImageUrl } from "@langwatch/design-system/external-image";
import type { ReactNode } from "react";

import { DatasetPreviewTable, type DatasetPreviewTableProps } from "./dataset-preview-table.tsx";

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

/** The preview table with image cells drawn as images. */
export function DatasetImagePreviewTable(props: DatasetPreviewTableProps) {
  return <DatasetPreviewTable {...props} renderImage={renderImage} />;
}
