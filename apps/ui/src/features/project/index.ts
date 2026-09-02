/**
 * The general Settings family, as this application composes it.
 *
 * The screen lives in `@langwatch/project-web`; what belongs to the application
 * is the page key, the permission policy, the settings chrome, the transport,
 * and the host port that turns this application's capabilities into the
 * questions the screen asks.
 */

import { projectApi } from "@langwatch/project-web/screens/project";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { projectPageLoaders } from "./ui/sections/project-routes";

export const projectApiBinding: UiFeatureApiBinding = uiFeatureApi({
  // The SCOPE, not the package: `features/home` mounts the same package's
  // `screens/home` transport, and two bindings sharing a name make a
  // composition diagnostic say nothing about which one it means.
  name: "@langwatch/project-web/screens/project",
  api: projectApi,
});

export { projectPageLoaders };
