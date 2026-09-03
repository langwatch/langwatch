/**
 * Organization settings: screen in `@langwatch/organization-web`. Serves
 * two drawers, `inviteMember` and `createTeam`, opened from the Members
 * page, the command palette and the Teams page.
 */

import { organizationApi } from "@langwatch/organization-web/screens/organization";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { organizationPageLoaders } from "./ui/sections/organization-routes";

export const organizationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/organization-web",
  api: organizationApi,
});

/** The drawers this family serves, by the name the address uses. */
export const organizationDrawers: UiDrawerRegistry = {
  inviteMember: lazyDrawer({
    factory: () => import("./ui/sections/organization-drawers"),
    key: "InviteMemberDrawer",
  }),
  createTeam: lazyDrawer({
    factory: () => import("./ui/sections/organization-drawers"),
    key: "CreateTeamDrawer",
  }),
};

export { organizationPageLoaders };
