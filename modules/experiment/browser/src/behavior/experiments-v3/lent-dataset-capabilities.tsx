/** What dataset lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  AddOrEditDatasetDrawerToken,
  DatasetRecordSyncToken,
  type AddOrEditDatasetDrawerProps,
  type DatasetRecordSyncProps,
} from "@langwatch/dataset-contract";

/** Dataset's create-or-edit drawer, rendered as dataset lends it. */
export function AddOrEditDatasetDrawer(props: AddOrEditDatasetDrawerProps) {
  return <Lent of={AddOrEditDatasetDrawerToken} props={props} />;
}

/** Dataset's record sync, which saves pending edits and draws nothing. */
export function DatasetRecordSync(props: DatasetRecordSyncProps) {
  return <Lent of={DatasetRecordSyncToken} props={props} />;
}
