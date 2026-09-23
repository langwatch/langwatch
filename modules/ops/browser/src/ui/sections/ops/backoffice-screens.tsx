/**
 * Backoffice is one screen over six addresses, so each address needs its own
 * component to route to: the resource is bound here rather than read from the
 * router, which a screen may not reach for.
 */

import OpsBackofficeScreen from "./ops-backoffice.screen.tsx";

export function BackofficeUsersScreen() {
  return <OpsBackofficeScreen resource="users" />;
}

export function BackofficeOrganizationsScreen() {
  return <OpsBackofficeScreen resource="organizations" />;
}

export function BackofficeProjectsScreen() {
  return <OpsBackofficeScreen resource="projects" />;
}

export function BackofficeSubscriptionsScreen() {
  return <OpsBackofficeScreen resource="subscriptions" />;
}

export function BackofficeSsoConnectionsScreen() {
  return <OpsBackofficeScreen resource="sso-connections" />;
}

export function BackofficeBugReportsScreen() {
  return <OpsBackofficeScreen resource="bug-reports" />;
}

export function BackofficeLicensesScreen() {
  return <OpsBackofficeScreen resource="licenses" />;
}

export function BackofficeSelfHostedInstancesScreen() {
  return <OpsBackofficeScreen resource="self-hosted-instances" />;
}
