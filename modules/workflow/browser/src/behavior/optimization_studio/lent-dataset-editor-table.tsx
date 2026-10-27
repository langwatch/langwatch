/** Dataset's editor table, as dataset lends it (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { DatasetEditorTableToken, type DatasetEditorTableProps } from "@langwatch/dataset-client";

/** Dataset's editor over a saved dataset or one this module holds in memory. */
export function DatasetEditorTable(props: DatasetEditorTableProps) {
  return <Lent of={DatasetEditorTableToken} props={props} />;
}
