/** Dataset's record sync, lent to other modules (ARCHITECTURE.md §3.4, rule 7). */

import type { UiDatasetRecordSyncProps } from "@langwatch/browser-host/declarations";

import { useDatasetRecordSync } from "../../../behavior/datasets/editor/use-dataset-record-sync.ts";

/** Saves a borrower's pending record edits; draws nothing. */
export function LentDatasetRecordSync(props: UiDatasetRecordSyncProps) {
  useDatasetRecordSync(props);
  return null;
}
