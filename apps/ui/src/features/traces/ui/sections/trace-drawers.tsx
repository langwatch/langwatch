/**
 * The trace drawers, mounted in the hosts their package asks for.
 *
 * A DRAWER IS NOT A PAGE: it opens over whatever page the reader is on, so the
 * host travels with the drawer rather than with the address. Wrapping happens
 * here, once, and the whole file is behind the registry's lazy import.
 *
 * "ADD TO DATASET" NEEDS TWO HOSTS, which is why it is composed rather than
 * merely wrapped. The drawer itself reads the TRACE host — the project, the
 * reader, their grants — while the dataset editor its "+ Create New" and "Edit
 * Columns" lead to is `@langwatch/dataset-web`'s and runs on the STUDIO host,
 * the same one `studio-host-drawers` mounts `addOrEditDataset` in. A feature
 * package may mount neither, and the editor cannot be reached by navigating
 * either: `openDrawer` carries only what a URL carries and the editor's
 * `onSuccess` is a function. So the application hands the hosted editor in.
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
