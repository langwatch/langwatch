/** Analytics' Dashboards section, placed by navigation (§10.1). */

import { ProductDashboardsToken, type ProductDashboardsProps } from "@langwatch/analytics-client";
import { Lent } from "@langwatch/browser-host/lent";

/** A product's "Dashboards" section with the organization's area open: its boards and "+". */
export function ProductDashboards(props: ProductDashboardsProps) {
  return <Lent of={ProductDashboardsToken} props={props} />;
}
