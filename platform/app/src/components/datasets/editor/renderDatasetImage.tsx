import type { ReactNode } from "react";

import { ExternalImage, getImageUrl } from "~/components/ExternalImage";

/**
 * How an "image" dataset cell is drawn.
 *
 * `@langwatch/dataset-web` renders the table but cannot reach the app's
 * image proxy, so every host of a dataset table injects this through
 * `DatasetTableContextValue.renderImage`. Keeping the one implementation here
 * is what stops the hosts drifting apart on size or expandability.
 *
 * Answers null when the value is not an image reference, which is what tells
 * the cell to fall back to rendering the raw value.
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
