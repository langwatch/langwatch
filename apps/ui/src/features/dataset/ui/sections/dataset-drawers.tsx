/** Exports dataset drawer components with DatasetHost. */

import { SelectDatasetDrawer as SelectDataset } from "@langwatch/dataset-web/drawers";

import { withHost } from "../../../../ui/sections/ui-page";
import { DatasetHost } from "./dataset-host";

export const SelectDatasetDrawer = withHost(DatasetHost, SelectDataset);
