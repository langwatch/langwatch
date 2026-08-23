/**
 * One saved LangWatchQL chart, rendered as a dashboard widget.
 *
 * The widget references its chart by id and reads the definition live, rather
 * than drawing a copy snapshotted when the chart was placed. A member who fixes
 * a chart's SQL expects every dashboard showing it to be fixed too; a snapshot
 * would leave the old answer on the grid with nothing on screen admitting it
 * was stale.
 *
 * Three things decide what it draws, and they come from three different places
 * on purpose:
 *
 *  - **The statement and its parameters** come from the saved chart. The saved
 *    parameter values are run as-is: a widget offers no overrides, because a
 *    dashboard is a shared surface and a per-viewer override would mean two
 *    members discussing the same card were looking at different numbers.
 *  - **The period** comes from the dashboard's own period control, read from
 *    URL state through `usePeriodSelector` exactly as every builder chart on
 *    the grid reads it. One control moves every card, which is what makes the
 *    cards comparable.
 *  - **The datapoint step** is the widget's own, chosen per card, because the
 *    right bucket size is a property of the question the chart asks and not of
 *    the period it happens to be showing.
 *
 * That last split is why this surface coarsens rather than refuses. The saved
 * step meets a period the widget does not own and cannot predict: a member can
 * drag the dashboard to a year with a one-second chart on it. Refusing would
 * blank a card whose owner changed nothing, so the run asks for `"coarsen"` and
 * says what it got.
 *
 * @see ./LazyLangWatchQLWidgetChart — the Vega boundary this mounts
 * @see ../hooks/useLangWatchQLWidgetRun — when to run, and which response wins
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";

import { usePeriodSelector } from "~/components/PeriodSelector";
import { HandledErrorAlert } from "~/features/errors";
import { api } from "~/utils/api";

import { useLangWatchQLWidgetRun } from "../hooks/useLangWatchQLWidgetRun";
import { widgetCoarsenedNotice } from "../logic/widgetCoarsenedNotice";
import type { LangWatchQLDatasetColumn } from "../visualization/visualization.types";

import { LazyLangWatchQLWidgetChart } from "./LazyLangWatchQLWidgetChart";

/**
 * The default datapoint step for a widget whose chart declares the granularity
 * parameter but has no step stored yet — one minute, the middle of the offered
 * steps. Coarsened up from here when the dashboard's period is wide.
 */
export const LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS = 60;

export interface LangWatchQLDashboardWidgetProps {
  readonly chartId: string;
  readonly projectId: string;
  /**
   * The step this card was placed with. Absent falls back to
   * {@link LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS}; ignored entirely by a
   * statement that does not declare the granularity parameter.
   */
  readonly granularitySeconds?: number;
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
    chartLoaded: !!chartQuery.data,
    start: period.startDate.getTime(),
    end: period.endDate.getTime(),
    granularitySeconds:
      granularitySeconds ?? LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS,
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
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't run this chart's query"
      />
    );
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
      {coarsenedFrom !== undefined &&
        result.granularitySeconds !== undefined && (
          <Box
            role="status"
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
