/**
 * The header and tabs every analytics page sits in — chrome (sidebar, top bar, drawer mount)
 * belongs to the route tree, so this drops the outermost wrapper. Which tab is selected
 * ARRIVES AS A PROP, never read. A dashboard page adds its own title row above the content.
 */

import { PageHeaderSizeProvider } from "@langwatch/design-system/page-layout";
import { Box } from "@langwatch/design-system/primitives";
import type { PropsWithChildren } from "react";

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { AnalyticsHeader } from "./analytics-header.tsx";
import { AnalyticsTabs } from "./analytics-tabs.tsx";
import { DashboardTitleRow, type DashboardTitleRowProps } from "./dashboard-title-row.tsx";
import { LegacyAnalyticsBanner } from "./legacy-analytics-banner.tsx";
import { SavedViewsScope } from "./saved-views-scope.tsx";

/** Which header tab the page being rendered is; `reports` lights the Dashboards menu tab. */
export type AnalyticsTab = "overview" | "users" | "topics" | "metrics" | "evaluations" | "reports";

export default function AnalyticsLayout({
  children,
  tab,
  activeDashboardId,
  dashboard,
}: PropsWithChildren<{
  tab?: AnalyticsTab;
  activeDashboardId?: string;
  /** A custom dashboard's own title row, under the header. */
  dashboard?: DashboardTitleRowProps;
}>) {
  const host = useAnalyticsHost();
  const project = host.project();

  return (
    <SavedViewsScope>
      <PageHeaderSizeProvider size="lg">
        <Box
          data-testid="analytics-layout"
          background="bg.surface"
          position="relative"
          flex={1}
          minWidth={0}
          minHeight={0}
          overflowY="auto"
          overflowX="hidden"
        >
          <LegacyAnalyticsBanner />
          <AnalyticsHeader
            tabs={
              project?.slug ? (
                <AnalyticsTabs
                  projectSlug={project.slug}
                  tab={tab}
                  activeDashboardId={activeDashboardId}
                />
              ) : null
            }
          />
          <Box
            data-testid="analytics-content"
            paddingX={6}
            paddingTop={dashboard ? 2 : 4}
            paddingBottom={16}
          >
            {dashboard ? <DashboardTitleRow {...dashboard} /> : null}
            {children}
          </Box>
        </Box>
      </PageHeaderSizeProvider>
    </SavedViewsScope>
  );
}
