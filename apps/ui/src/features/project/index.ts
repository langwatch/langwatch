/**
 * The general Settings family, as this application composes it.
 *
 * The screen lives in `@langwatch/project-web`; what belongs to the application
 * is the page key, the permission policy, the settings chrome, the transport,
 * and the host port that turns this application's capabilities into the
 * questions the screen asks.
 */

import { projectApi } from "@langwatch/project-web/screens/project";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { projectPageLoaders } from "./ui/sections/project-routes";

export const projectApiBinding: UiFeatureApiBinding = uiFeatureApi({
  // The SCOPE, not the package: `features/home` mounts the same package's
  // `screens/home` transport, and two bindings sharing a name make a
  // composition diagnostic say nothing about which one it means.
  name: "@langwatch/project-web/screens/project",
  api: projectApi,
});

/**
 * The drawers this family serves, by the name the address uses.
 *
 * BOTH CAME BACK FROM `platform/app`, deleted in `cc91631cd8`. The Teams page's
 * header button and its per-team "+ New Project", the team form and the
 * CLI-auth screen all kept writing `?drawer.open=createProject`, and the Teams
 * page's overflow menu kept writing `editProject`; every one of them changed
 * the URL and opened nothing. Their components are
 * `@langwatch/organization-web`'s, because that is where the openers and every
 * hook they need already live.
 */
export const projectDrawers: UiDrawerRegistry = {
  createProject: lazyDrawer({
    factory: () => import("./ui/sections/project-drawers"),
    key: "CreateProjectDrawer",
  }),
  editProject: lazyDrawer({
    factory: () => import("./ui/sections/project-drawers"),
    key: "EditProjectDrawer",
  }),
};

export { projectPageLoaders };
