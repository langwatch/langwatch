/**
 * The organization settings family, as this application composes it.
 *
 * The screen lives in `@langwatch/organization-web`; what belongs to the
 * application is which page key the address answers, the grant in front of it,
 * the settings chrome around it, the transport its hooks run on, and the host
 * port that turns this application's capabilities into the questions the screen
 * asks — including the one no family asked before it, handing the reader a file.
 *
 * IT SERVES TWO DRAWERS AS WELL AS ITS SCREENS. The Members page and the
 * command palette both open `inviteMember`, and the Teams page opens
 * `createTeam`; both components are `@langwatch/organization-web`'s and neither
 * was registered anywhere, so the address was written and nothing opened.
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
