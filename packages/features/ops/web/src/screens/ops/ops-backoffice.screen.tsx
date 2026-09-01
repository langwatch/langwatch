/**
 * The Backoffice, as one screen over six addresses.
 *
 * `platform/app` had six page files, each three lines: a resource view inside a
 * shared `BackofficeShell` that gated on `api.user.isAdmin` and rendered
 * `SettingsLayout`. Both halves of that shell belong somewhere else now — the
 * gate is the page guard's (`ops:manage`, the platform-tier grant the operator
 * allow-list already issues) and `SettingsLayout` is application chrome the
 * route tree serves — so what is left is the resource, and the resource is a
 * PROP.
 *
 * That is the automations family's shape, taken for the same reason: the route
 * table gives each address its own page key, so `apps/ui` maps a key to a
 * resource and this screen is told which one rather than reading the address to
 * learn what the router already knew. Six keys, one loader, no pathname on the
 * host port.
 *
 * ADMIN GATING STAYS DECOUPLED FROM `ops:view`, which is the property the
 * platform shell's docblock asked for out loud: if operator access ever widens
 * past the allow-list, the Backoffice must not widen with it. `ops:manage` is
 * the narrower of the two platform-tier grants and is what the guard in
 * `apps/ui` asks for on these six keys alone.
 */

import type { ComponentType } from "react";
import BugReportsView from "../../features/backoffice/ui/sections/bug-reports-view";
import OrganizationsView from "../../features/backoffice/ui/sections/organizations-view";
import ProjectsView from "../../features/backoffice/ui/sections/projects-view";
import SsoConnectionsView from "../../features/backoffice/ui/sections/sso-connections-view";
import SubscriptionsView from "../../features/backoffice/ui/sections/subscriptions-view";
import UsersView from "../../features/backoffice/ui/sections/users-view";

/** The resources the Backoffice serves, in the order the sidebar lists them. */
export const BACKOFFICE_RESOURCES = [
  "users",
  "organizations",
  "projects",
  "subscriptions",
  "sso-connections",
  "bug-reports",
] as const;

export type BackofficeResource = (typeof BACKOFFICE_RESOURCES)[number];

const VIEWS: Record<BackofficeResource, ComponentType> = {
  users: UsersView,
  organizations: OrganizationsView,
  projects: ProjectsView,
  subscriptions: SubscriptionsView,
  "sso-connections": SsoConnectionsView,
  "bug-reports": BugReportsView,
};

export default function OpsBackofficeScreen({
  resource = "users",
}: {
  resource?: BackofficeResource;
}) {
  const View = VIEWS[resource];
  return <View />;
}
