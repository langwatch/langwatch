/**
 * Organization settings: screen in `@langwatch/organization-web`. Serves
 * two drawers, `inviteMember` and `createTeam`, opened from the Members
 * page, the command palette and the Teams page.
 */

import { organizationApi } from "@langwatch/organization-web/screens/organization";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { organizationPageLoaders } from "./ui/sections/organization-routes";

export const organizationFeature = uiFeature({
  name: "@langwatch/organization-web",
  api: organizationApi,
  loaders: organizationPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    inviteMember: lazyDrawer({
      factory: () => import("./ui/sections/organization-drawers"),
      key: "InviteMemberDrawer",
    }),
    createTeam: lazyDrawer({
      factory: () => import("./ui/sections/organization-drawers"),
      key: "CreateTeamDrawer",
    }),
  },
});
