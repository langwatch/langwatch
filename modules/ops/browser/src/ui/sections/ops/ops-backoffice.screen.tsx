/** Backoffice over six addresses: one screen with resource as a prop. */

import type { ComponentType } from "react";
import BugReportsView from "../../../features/backoffice/ui/sections/bug-reports-view.tsx";
import OrganizationsView from "../../../features/backoffice/ui/sections/organizations-view.tsx";
import ProjectsView from "../../../features/backoffice/ui/sections/projects-view.tsx";
import SsoConnectionsView from "../../../features/backoffice/ui/sections/sso-connections-view.tsx";
import SubscriptionsView from "../../../features/backoffice/ui/sections/subscriptions-view.tsx";
import type { BackofficeResource } from "../../../model/backoffice-resources.ts";
import UsersView from "../../../features/backoffice/ui/sections/users-view.tsx";

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
