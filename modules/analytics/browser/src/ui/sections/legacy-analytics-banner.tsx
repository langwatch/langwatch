/**
 * Tells a member the analytics pages are the legacy view and offers Dashboards, only
 * where Dashboards opens for them (dashboards-v1.feature AC3c).
 */

import { Banner, BannerAction } from "@langwatch/design-system/banner";

import {
  DASHBOARDS_FLAG,
  DASHBOARDS_PERMISSION,
  dashboardsAccess,
} from "../../features/dashboards/model/dashboards-access.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { Link } from "../elements/analytics-link.tsx";

export function LegacyAnalyticsBanner() {
  const host = useAnalyticsHost();
  const slug = host.project()?.slug;
  const access = dashboardsAccess({
    flag: host.featureFlag(DASHBOARDS_FLAG),
    isSettled: host.isSettled(),
    canView: host.hasPermission(DASHBOARDS_PERMISSION),
  });
  if (!slug || access !== "open") return null;

  return (
    <Banner
      status="warning"
      placement="top"
      title="You are viewing legacy analytics"
      action={
        <BannerAction asChild>
          <Link href={`/${slug}/dashboards`}>Open Dashboards</Link>
        </BannerAction>
      }
      data-testid="legacy-analytics-banner"
    >
      Dashboards replaces this view.
    </Banner>
  );
}
