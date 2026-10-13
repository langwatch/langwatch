import { Banner } from "@langwatch/design-system/banner";
import type React from "react";

/**
 * Persistent banner across the top of the table while the trace list is rendering
 * `SAMPLE_PREVIEW_TRACES` (i.e. `usePreviewTracesActive` is true).
 */
export const SampleDataBanner: React.FC = () => {
  return (
    <Banner status="info" placement="top">
      Sample data: facets, filters, and the drawer all work, but nothing here is real.
    </Banner>
  );
};
