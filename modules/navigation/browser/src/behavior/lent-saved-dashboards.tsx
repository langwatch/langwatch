/** Analytics' saved and starred dashboards, drawn where navigation places them (§10.1). */

import {
  SavedDashboardsToken,
  type SavedDashboardsProps,
  StarredDashboardsToken,
} from "@langwatch/analytics-client";
import { Lent } from "@langwatch/browser-host/lent";

export function SavedDashboards(props: SavedDashboardsProps) {
  return <Lent of={SavedDashboardsToken} props={props} />;
}

/** The member's starred dashboards; analytics draws nothing when there are none. */
export function StarredDashboards() {
  return <Lent of={StarredDashboardsToken} props={{}} />;
}
