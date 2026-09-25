/**
 * One saved LangWatchQL chart, rendered as a dashboard widget. Reads the
 * chart's definition live, never a snapshot, so a SQL fix propagates to
 * every dashboard showing it; a too-fine step asks to coarsen, not refuse.
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { usePeriodSelector } from "@langwatch/analytics-browser-kit";
import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import type { LangWatchQLDatasetColumn } from "@langwatch/analytics-contract/visualization";
import { useMemo } from "react";

import { analyticsApi as api } from "../../behavior/analytics-api.ts";
import { useLangWatchQLWidgetRun } from "../../behavior/use-langwatch-ql-widget-run.ts";
import { widgetCoarsenedNotice } from "../../model/widget-coarsened-notice.ts";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";
import { LazyLangWatchQLWidgetChart } from "./lazy-langwatch-ql-widget-chart.tsx";
import { useDashboardRefreshedAt } from "./use-dashboard-auto-refresh.ts";

/**
 * The default datapoint step for a widget whose chart declares the granularity
 * parameter but has no step stored yet — one minute, the middle of the offered
 * steps. Coarsened up from here when the dashboard's period is wide.
 */
export const LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS: LangWatchQLGranularityStep = 60;

export interface LangWatchQLDashboardWidgetProps {
  readonly chartId: string;
  readonly projectId: string;
  /**
   * The step this card was placed with. Absent falls back to
   * {@link LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS}; ignored entirely by a
   * statement that does not declare the granularity parameter.
   */
  readonly granularitySeconds?: LangWatchQLGranularityStep;
  /** The card's title, used to describe the chart to a screen reader. */
  readonly name: string;
}

export function LangWatchQLDashboardWidget({
  chartId,
  projectId,
  granularitySeconds,
  name,
}: LangWatchQLDashboardWidgetProps) {
  const { period } = usePeriodSelector();
  const refreshedAt = useDashboardRefreshedAt();

  const chartQuery = api.analytics.savedWorkbenchCharts.getById.useQuery(
    { id: chartId, projectId },
    { enabled: !!projectId && !!chartId },
  );

  // Epoch milliseconds rather than the `Date` objects `usePeriodSelector`
  // hands back: two `Date`s for the same instant are never `Object.is`-equal,
  // so a dependency built on them would re-run the query on every render.
  const { result, error } = useLangWatchQLWidgetRun({
    chartId,
    projectId,
    isChartLoaded: !!chartQuery.data,
    start: period.startDate.epochMilliseconds,
    end: period.endDate.epochMilliseconds,
    granularitySeconds: granularitySeconds ?? LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS,
    ...(refreshedAt === undefined ? {} : { refreshedAt }),
  });

  const columns = useMemo(
    () => (result?.columns ?? []) as readonly LangWatchQLDatasetColumn[],
    [result],
  );

  if (chartQuery.error) {
    return <HandledErrorAlert error={chartQuery.error} />;
  }

  // A member's own SQL failing is a knowable failure: the run surfaces it as
  // a handled error whose code the shared presentation registry turns into
  // copy — the same words the workbench shows for the same refusal. Only a
  // failure the platform genuinely cannot name falls back to the generic
  // treatment, under a headline that at least says what the card was doing.
  if (error) {
    return <HandledErrorAlert error={error} fallbackTitle="Couldn't run this chart's query" />;
  }

  if (!chartQuery.data || !result) {
    return (
      <HStack gap={2} color="fg.muted" padding={4}>
        <Spinner size="sm" />
        <Text fontSize="13px">Loading the chart</Text>
      </HStack>
    );
  }

  return (
    <WidgetBody
      result={result}
      columns={columns}
      vegaLiteSpec={chartQuery.data.definition.vegaLiteSpec}
      name={name}
    />
  );
}

/** The loaded card: the coarsening notice, then the chart itself. */
function WidgetBody({
  result,
  columns,
  vegaLiteSpec,
  name,
}: {
  result: NonNullable<ReturnType<typeof useLangWatchQLWidgetRun>["result"]>;
  columns: readonly LangWatchQLDatasetColumn[];
  vegaLiteSpec: Record<string, unknown> | undefined;
  name: string;
}) {
  const coarsenedFrom = result.coarsenedFromSeconds;

  return (
    <VStack align="stretch" gap={2} height="full" minWidth={0}>
      {coarsenedFrom !== undefined && result.granularitySeconds !== undefined && (
        <Box
          as="output"
          display="block"
          data-testid="lwql-widget-coarsened-notice"
          fontSize="12px"
          color="fg.muted"
        >
          {widgetCoarsenedNotice({
            from: coarsenedFrom,
            to: result.granularitySeconds,
          })}
        </Box>
      )}

      <Box flex={1} minHeight={0}>
        <LazyLangWatchQLWidgetChart
          columns={columns}
          rows={result.rows}
          {...(vegaLiteSpec ? { vegaLiteSpec } : {})}
          ariaLabel={name}
        />
      </Box>
    </VStack>
  );
}
