/**
 * Which page key the Audit Log address answers. Grants are not all the
 * same: most are `organization:manage`, team detail is `team:view`. The
 * plan gate below Enterprise is not a second guard.
 */

import { organizationScreens } from "@langwatch/organization-web/screens/organization";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { OrganizationHost } from "./organization-host";

const AUDIT_LOG_PAGE_PERMISSION = "organization:manage";
const MEMBERS_PAGE_PERMISSION = "organization:manage";
const TEAMS_PAGE_PERMISSION = "organization:manage";
const GROUPS_PAGE_PERMISSION = "organization:manage";
const TEAM_DETAIL_PAGE_PERMISSION = "team:view";

export const organizationPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/audit-log": uiPage({
    screen: async () => ({
      default: (await organizationScreens.auditLog()).default as ComponentType,
    }),
    host: OrganizationHost,
    settingsLayout: true,
    permission: AUDIT_LOG_PAGE_PERMISSION,
  }),
  "pages/settings/members": uiPage({
    screen: async () => ({
      default: (await organizationScreens.members()).default as ComponentType,
    }),
    host: OrganizationHost,
    settingsLayout: true,
    permission: MEMBERS_PAGE_PERMISSION,
  }),
  "pages/settings/teams": uiPage({
    screen: async () => ({
      default: (await organizationScreens.teams()).default as ComponentType,
    }),
    host: OrganizationHost,
    settingsLayout: true,
    permission: TEAMS_PAGE_PERMISSION,
  }),
  "pages/settings/teams/[team]": uiPage({
    screen: async () => ({
      default: (await organizationScreens.teamDetail()).default as ComponentType,
    }),
    host: OrganizationHost,
    settingsLayout: true,
    permission: TEAM_DETAIL_PAGE_PERMISSION,
  }),
  "pages/settings/groups": uiPage({
    screen: async () => ({
      default: (await organizationScreens.groups()).default as ComponentType,
    }),
    host: OrganizationHost,
    settingsLayout: true,
    permission: GROUPS_PAGE_PERMISSION,
  }),
};
