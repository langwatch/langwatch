/** Dataset's record sync, lent to other modules (ARCHITECTURE.md §3.4, rule 7). */

import type { DatasetRecordSyncProps } from "@langwatch/dataset-client";

import { useDatasetRecordSync } from "../../../behavior/datasets/editor/use-dataset-record-sync.ts";

/** Saves a borrower's pending record edits; draws nothing. */
export function LentDatasetRecordSync(props: DatasetRecordSyncProps) {
  useDatasetRecordSync(props);
  return null;
}
