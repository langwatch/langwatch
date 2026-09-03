/** The dataset drawers, mounted in the host their package asks for; a drawer travels with itself, not the address. */

import { SelectDatasetDrawer as SelectDataset } from "@langwatch/dataset-web/drawers";

import { withHost } from "../../../../ui/sections/ui-page";
import { DatasetHost } from "./dataset-host";

export const SelectDatasetDrawer = withHost(DatasetHost, SelectDataset);
