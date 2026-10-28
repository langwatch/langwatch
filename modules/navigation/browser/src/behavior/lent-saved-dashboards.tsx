/** Analytics' saved dashboards and its Dashboards section, placed by navigation (§10.1). */

import {
  SavedDashboardsToken,
  type SavedDashboardsProps,
  StarredDashboardsToken,
} from "@langwatch/analytics-client";
import { Lent } from "@langwatch/browser-host/lent";

export function SavedDashboards(props: SavedDashboardsProps) {
  return <Lent of={SavedDashboardsToken} props={props} />;
}

/** The Dashboards section: the member's pinned dashboards and the "+" that adds one. */
export function StarredDashboards() {
  return <Lent of={StarredDashboardsToken} props={{}} />;
}
