import { PageLayout } from "@langwatch/design-system/page-layout";
import type { ReactNode } from "react";

import { useAnalyticsPeriod } from "../../behavior/use-analytics-period.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { AnalyticsOverflowMenu } from "./analytics-overflow-menu.tsx";
import { AnalyticsPeriodPicker } from "./analytics-period-picker.tsx";
import { FilterToggle } from "./filter-toggle.tsx";

/** The one analytics header: the area's title, its page tabs, then the controls at the right. */
export function AnalyticsHeader({ tabs }: { tabs: ReactNode }) {
  const host = useAnalyticsHost();
  const project = host.project();
  const {
    period: { startDate, endDate },
    mode,
    setPeriod,
    setRelativePeriod,
  } = useAnalyticsPeriod();

  return (
    <PageLayout.Header
      actions={
        <>
          <FilterToggle />
          <AnalyticsPeriodPicker
            period={{ startDate, endDate }}
            mode={mode}
            setPeriod={setPeriod}
            setRelativePeriod={setRelativePeriod}
          />
          <AnalyticsOverflowMenu
            onShowTraces={() => {
              // Trace Explorer keeps its time range in the URL fragment
              // (#<lens>?from=<ms>&to=<ms>), so carry the analytics period over.
              host.navigate(
                `/${project?.slug}/traces#all-traces?from=${startDate.epochMilliseconds}&to=${endDate.epochMilliseconds}`,
              );
            }}
          />
        </>
      }
    >
      <PageLayout.Heading>Analytics</PageLayout.Heading>
      {tabs}
    </PageLayout.Header>
  );
}
