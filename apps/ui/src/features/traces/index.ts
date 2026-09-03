/**
 * The Trace family, as this application composes it.
 *
 * The Trace Explorer — the table, the filter rail, the search bar, the drawer
 * with its waterfall, conversation, transcript, terminal and session views, the
 * onboarding walk and the shared-trace page — lives in `@langwatch/trace-web`;
 * what belongs to the application is everything they are not allowed to own:
 * which page key an address answers, the permission policy in front of it, the
 * transport its hooks run on, and the host port that turns this application's
 * capabilities into the questions the family asks.
 *
 * IT COMPOSES TWO OVERLAYS AS WELL AS TWO PAGES. `addDatasetRecord` is a
 * registered drawer like any other; `traceV2Details` cannot be one, and
 * `UiTraceDrawerMount` is why — see the module it names.
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
