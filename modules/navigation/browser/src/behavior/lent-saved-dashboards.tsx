/** Analytics' saved dashboards and its Dashboards section, placed by navigation (§10.1). */

import {
  ProductDashboardsToken,
  type ProductDashboardsProps,
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

/** A product's "Dashboards" section with the organization's area on: its boards and "+". */
export function ProductDashboards(props: ProductDashboardsProps) {
  return <Lent of={ProductDashboardsToken} props={props} />;
}
