/**
 * Instance admin and Cloud admin, one component per address (ARCHITECTURE.md §3.5).
 * Cloud admin is LangWatch's own tooling: off SaaS it answers as an unknown page.
 */

import BugReportsView from "../../../features/admin/ui/sections/bug-reports-view.tsx";
import IdentityLookupView from "../../../features/admin/ui/sections/identity-lookup-view.tsx";
import LicensesView from "../../../features/admin/ui/sections/licenses-view.tsx";
import OrganizationsView from "../../../features/admin/ui/sections/organizations-view.tsx";
import ProjectsView from "../../../features/admin/ui/sections/projects-view.tsx";
import SelfHostedInstancesView from "../../../features/admin/ui/sections/self-hosted-instances-view.tsx";
import SsoConnectionsView from "../../../features/admin/ui/sections/sso-connections-view.tsx";
import SubscriptionsView from "../../../features/admin/ui/sections/subscriptions-view.tsx";
import UsersView from "../../../features/admin/ui/sections/users-view.tsx";
import { CloudOnly } from "./cloud-only.tsx";

export {
  IdentityLookupView as IdentityLookupScreen,
  OrganizationsView as OrganizationsScreen,
  ProjectsView as ProjectsScreen,
  SsoConnectionsView as SsoConnectionsScreen,
  UsersView as UsersScreen,
};

export function CloudSubscriptionsScreen() {
  return (
    <CloudOnly>
      <SubscriptionsView />
    </CloudOnly>
  );
}

export function CloudLicensesScreen() {
  return (
    <CloudOnly>
      <LicensesView />
    </CloudOnly>
  );
}

export function CloudSelfHostedInstancesScreen() {
  return (
    <CloudOnly>
      <SelfHostedInstancesView />
    </CloudOnly>
  );
}

export function CloudBugReportsScreen() {
  return (
    <CloudOnly>
      <BugReportsView />
    </CloudOnly>
  );
}
