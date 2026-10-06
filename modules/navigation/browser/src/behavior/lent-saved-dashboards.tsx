/** Analytics' saved-dashboards list, drawn where navigation places it (§10.1). */

import { SavedDashboardsToken, type SavedDashboardsProps } from "@langwatch/analytics-contract";
import { Lent } from "@langwatch/browser-host/lent";

export function SavedDashboards(props: SavedDashboardsProps) {
  return <Lent of={SavedDashboardsToken} props={props} />;
}
