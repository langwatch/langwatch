import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { ReactNode } from "react";
import { LuListTree } from "react-icons/lu";

import { useAnalyticsPeriod } from "../../behavior/use-analytics-period.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { AnalyticsPeriodPicker } from "./analytics-period-picker.tsx";
import { FilterToggle } from "./filter-toggle.tsx";

/** The one analytics header: the area's title, its page tabs, then the controls at the right. */
export function AnalyticsHeader({
  tabs,
  extraHeaderButtons,
}: {
  tabs: ReactNode;
  extraHeaderButtons?: ReactNode;
}) {
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
          <Tooltip content="Show traces behind those metrics">
            <PageLayout.HeaderButton
              variant="ghost"
              onClick={() => {
                // Trace Explorer keeps its time range in the URL fragment
                // (#<lens>?from=<ms>&to=<ms>), so carry the analytics period over.
                host.navigate(
                  `/${project?.slug}/traces#all-traces?from=${startDate.epochMilliseconds}&to=${endDate.epochMilliseconds}`,
                );
              }}
            >
              <LuListTree />
              Show traces
            </PageLayout.HeaderButton>
          </Tooltip>
          {extraHeaderButtons}
        </>
      }
    >
      <PageLayout.Heading>Analytics</PageLayout.Heading>
      {tabs}
    </PageLayout.Header>
  );
}
