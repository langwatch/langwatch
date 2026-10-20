import { PageLayout } from "@langwatch/design-system/page-layout";

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import type { AnalyticsTab } from "./analytics-layout.tsx";
import { DashboardsTabMenu } from "./custom-dashboards-section.tsx";

/** The analytics pages as header tabs; custom dashboards sit behind the Dashboards menu tab. */
export function AnalyticsTabs({
  projectSlug,
  tab,
  activeDashboardId,
}: {
  projectSlug: string;
  tab?: AnalyticsTab;
  activeDashboardId?: string;
}) {
  const host = useAnalyticsHost();
  const base = `/${projectSlug}/analytics`;
  const tabs = {
    overview: { label: "Overview", href: base },
    users: { label: "Users", href: `${base}/users` },
    topics: { label: "Topics", href: `${base}/topics` },
    metrics: { label: "LLM metrics", href: `${base}/metrics` },
    evaluations: { label: "Evaluations", href: `${base}/evaluations` },
  };
  const activeHref = !tab || tab === "reports" ? "" : tabs[tab].href;

  return (
    <PageLayout.Tabs
      label="Analytics pages"
      tabs={Object.values(tabs)}
      activeHref={activeHref}
      onNavigate={(href) => host.navigate(href)}
    >
      <DashboardsTabMenu
        projectSlug={projectSlug}
        activeDashboardId={tab === "reports" ? activeDashboardId : void 0}
        isActive={tab === "reports"}
      />
    </PageLayout.Tabs>
  );
}
