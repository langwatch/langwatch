import { Banner } from "@langwatch/design-system/banner";

import type { SavedRecordsCut } from "../../../model/experiments-v3/types.ts";

const rowCount = new Intl.NumberFormat("en-US");

/**
 * Shown when the page holds fewer rows of the active saved dataset than the
 * dataset has, so the grid never ends early without saying so.
 * @see specs/experiments-v3/dataset-management.feature
 */
export function WorkbenchRowsCutBanner({ cut }: { cut: SavedRecordsCut }) {
  return (
    <Banner status="warning" placement="top" data-testid="workbench-rows-cut-banner">
      Showing the first {rowCount.format(cut.loadedRows)} of {rowCount.format(cut.totalRows)} rows.
      This dataset is too large to show in full here. A run still covers all{" "}
      {rowCount.format(cut.totalRows)} rows, and results for rows that are not shown appear on the
      run&apos;s results page.
    </Banner>
  );
}
