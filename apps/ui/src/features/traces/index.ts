/**
 * Traces: Explorer, drawer and shared-trace page, all in `@langwatch/trace-web`.
 * `traceV2Details` can't be a registered drawer — see `trace-drawer-mount.tsx`.
 */

import { traceApi } from "@langwatch/trace-web/screens/traces";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { tracePageLoaders } from "./ui/sections/routes";

export const traceFeature = uiFeature({
  name: "@langwatch/trace-web",
  api: traceApi,
  loaders: tracePageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    addDatasetRecord: lazyDrawer({
      factory: () => import("./ui/sections/trace-drawers"),
      key: "AddDatasetRecordDrawer",
    }),
  },
});

export { UiTraceDrawerMount } from "./ui/sections/trace-drawer-mount";
