/**
 * Points a Dashboards page back to the legacy Analytics pages, which the Analytics menu
 * entry no longer opens (dashboards-v1.feature AC3i). The gate shows it only where
 * Dashboards opens, which needs analytics:view.
 */

import { Banner, BannerAction } from "@langwatch/design-system/banner";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { Link } from "../../../../ui/elements/analytics-link.tsx";

export function OldAnalyticsBanner() {
  const slug = useAnalyticsHost().project()?.slug;
  if (!slug) return null;

  return (
    <Banner
      status="info"
      placement="top"
      title="Looking for the old Analytics? It is still here."
      action={
        <BannerAction asChild>
          <Link href={`/${slug}/analytics`}>Open Analytics</Link>
        </BannerAction>
      }
      data-testid="old-analytics-banner"
    />
  );
}
