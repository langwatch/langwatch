/**
 * Which page key the Audit Log address answers, and what it is wrapped in.
 *
 * FIVE KEYS, FIVE SCREENS. Every key still reads the address the platform page
 * served, kept rather than renamed: the route transcript in `apps/ui/tests` is
 * the parity bar for the URL surface and fails the moment a page key changes,
 * so renaming one would spend that guard's signal on a cosmetic edit.
 *
 * GRANTS, one for one with the platform pages and NOT all the same — the
 * asymmetry is carried rather than tidied: members, teams and groups were
 * `organization:manage`, the audit log the same, and the team detail page was
 * `team:view` (a reader who may see a team may open it). The PLAN gate a reader
 * below Enterprise meets on the audit log is not a second guard here and
 * deliberately not one: hiding a paid capability makes it look missing rather
 * than purchasable.
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
