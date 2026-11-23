/** Analytics' saved dashboards and its Dashboards section, placed by navigation (§10.1). */

import {
  OrganizationStarredDashboardsToken,
  SavedDashboardsToken,
  type SavedDashboardsProps,
  StarredDashboardsToken,
  type StarredDashboardsProps,
} from "@langwatch/analytics-client";
import { Lent } from "@langwatch/browser-host/lent";

export function SavedDashboards(props: SavedDashboardsProps) {
  return <Lent of={SavedDashboardsToken} props={props} />;
}

/** The Dashboards section: the member's pinned dashboards and the "+" that adds one. */
export function StarredDashboards(props: StarredDashboardsProps) {
  return <Lent of={StarredDashboardsToken} props={props} />;
}

/** The "Starred dashboards" group: the member's stars across the organization. */
export function OrganizationStarredDashboards() {
  return <Lent of={OrganizationStarredDashboardsToken} props={{}} />;
}
