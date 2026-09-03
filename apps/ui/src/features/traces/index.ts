/**
 * Traces: Explorer, drawer and shared-trace page, all in `@langwatch/trace-web`.
 * `traceV2Details` can't be a registered drawer — see `trace-drawer-mount.tsx`.
 */

import { traceApi } from "@langwatch/trace-web/screens/traces";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";

import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { tracePageLoaders } from "./ui/sections/routes";

export const traceApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/trace-web",
  api: traceApi,
});

/** The drawers this family serves, by the name the address uses. */
export const traceDrawers: UiDrawerRegistry = {
  addDatasetRecord: lazyDrawer({
    factory: () => import("./ui/sections/trace-drawers"),
    key: "AddDatasetRecordDrawer",
  }),
};

export { tracePageLoaders };
export { UiTraceDrawerMount } from "./ui/sections/trace-drawer-mount";
