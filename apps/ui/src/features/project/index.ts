/** General Settings: single screen in `@langwatch/project-web`. */

import { projectApi } from "@langwatch/project-web/screens/project";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { projectPageLoaders } from "./ui/sections/project-routes";

export const projectFeature = uiFeature({
  // The SCOPE, not the package: `features/home` mounts the same package's
  // `screens/home` transport, and two bindings sharing a name make a
  // composition diagnostic say nothing about which one it means.
  name: "@langwatch/project-web/screens/project",
  api: projectApi,
  loaders: projectPageLoaders,
  /**
   * `createProject` opens from the Teams page header, each team's "+ New
   * Project", the team form and the CLI-auth screen; `editProject` from the
   * Teams overflow menu. Both are `@langwatch/organization-web`'s components.
   */
  drawers: {
    createProject: lazyDrawer({
      factory: () => import("./ui/sections/project-drawers"),
      key: "CreateProjectDrawer",
    }),
    editProject: lazyDrawer({
      factory: () => import("./ui/sections/project-drawers"),
      key: "EditProjectDrawer",
    }),
  },
});
