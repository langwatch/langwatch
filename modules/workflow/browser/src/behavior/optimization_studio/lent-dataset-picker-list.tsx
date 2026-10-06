/** Dataset's picker list, as dataset lends it (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import { DatasetPickerListToken, type DatasetPickerListProps } from "@langwatch/dataset-contract";

/** Dataset's list of the project's datasets, handing the pick back to this module. */
export function DatasetPickerList(props: DatasetPickerListProps) {
  return <Lent of={DatasetPickerListToken} props={props} />;
}
