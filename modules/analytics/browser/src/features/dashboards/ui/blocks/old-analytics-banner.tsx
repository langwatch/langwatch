/**
 * Points the member's My dashboard, where the Analytics entry lands, back to the legacy
 * Analytics pages (dashboards-v1.feature AC3i); no other board shows it (AC3t). The board
 * screen renders it past the gate and its refusals, so a refused member never sees it (AC21).
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
