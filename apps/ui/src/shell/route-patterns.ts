/**
 * Every route pattern the shell serves, committed as `route-patterns.generated.json` so a
 * module's test can match an address without importing the app.
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import { installedModuleScreens } from "@langwatch/browser/module-screens";

import { browserModules } from "../browser-modules.generated.ts";
import { uiRouteDescriptors, uiRouteTable } from "./ui-route-table";

export function uiRoutePatterns(): string[] {
  const patterns = [
    ...uiRouteDescriptors(uiRouteTable).map((descriptor) => descriptor.path),
    ...installedModuleScreens(browserModules).routes.project.map((route) => route.path),
  ].filter((path): path is string => typeof path === "string");
  return [...new Set(patterns)];
}
