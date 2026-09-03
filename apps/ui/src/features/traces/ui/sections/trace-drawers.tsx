/**
 * The trace drawers, mounted in the hosts their package asks for. Add To
 * Dataset composes two: trace for the drawer, studio for the editor it
 * opens — neither reachable via `openDrawer`, so it is handed in directly.
 */

import {
  AddDatasetRecordDrawer as AddDatasetRecord,
  type AddDatasetRecordDrawerProps,
} from "@langwatch/trace-web/drawers";

import { AddOrEditDatasetDrawer } from "../../../workflows/ui/sections/studio-host-drawers";
import { withHost } from "../../../../ui/sections/ui-page";
import { TraceHost } from "./trace-host";

const HostedAddDatasetRecord = withHost(TraceHost, AddDatasetRecord);

export function AddDatasetRecordDrawer(props: Omit<AddDatasetRecordDrawerProps, "DatasetEditor">) {
  return <HostedAddDatasetRecord {...props} DatasetEditor={AddOrEditDatasetDrawer} />;
}
