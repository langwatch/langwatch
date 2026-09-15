import type { ReactNode } from "react";

import { ExternalImage, getImageUrl } from "@langwatch/design-system/external-image";

/**
 * How an "image" dataset cell is drawn, injected by every table host through
 * `DatasetTableContextValue.renderImage`. Answers null for a non-image value.
 */
export const renderDatasetImage = (value: string): ReactNode | null => {
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
