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
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePeriodSelector } from "~/components/PeriodSelector";
import { HandledErrorAlert } from "~/features/errors";
import { api } from "~/utils/api";

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

  const run = api.analytics.savedWorkbenchCharts.run.useMutation();

  // Epoch milliseconds rather than the `Date` objects `usePeriodSelector`
  // hands back: two `Date`s for the same instant are never `Object.is`-equal,
  // so a dependency built on them would re-run the query on every render.
  const start = period.startDate.getTime();
  const end = period.endDate.getTime();

  const step = granularitySeconds ?? LWQL_WIDGET_DEFAULT_GRANULARITY_SECONDS;

  // `run` is a mutation because executing SQL is not a cacheable read, so the
  // widget drives it from an effect rather than getting react-query's own
  // fetch-on-change. The ref carries the last request actually issued so that
  // a re-render with the same period and step does not re-execute.
  const { mutate } = run;
  const lastRequest = useRef<string | null>(null);
  const requestKey = `${chartId}:${start}:${end}:${step}`;

  // Which request the rendered answer belongs to.
  //
  // A period drag fires a run per intermediate window, and nothing orders the
  // responses: a query over a narrow window can resolve after one over a wide
  // window issued later, leaving the card showing an answer for a period the
  // dashboard is no longer on — with no spinner and nothing on screen saying
  // so. Each issued request takes the next sequence number, and a resolution
  // is drawn only when it carries the latest one, so a straggler is dropped
  // rather than winning by arriving last.
  const issuedRequests = useRef(0);
  const [answer, setAnswer] = useState<{
    readonly sequence: number;
    // Derived from the mutation rather than re-declared, so the widget cannot
    // drift from the shape the procedure actually returns.
    readonly result: NonNullable<typeof run.data>;
  } | null>(null);

  useEffect(() => {
    if (!chartQuery.data) return;
    if (lastRequest.current === requestKey) return;
    lastRequest.current = requestKey;

    issuedRequests.current += 1;
    const sequence = issuedRequests.current;

    mutate(
      {
        id: chartId,
        projectId,
        timeWindow: { start, end },
        granularitySeconds: step,
        // The whole reason this surface differs from the workbench: see the
        // module docblock.
        onBudgetOverflow: "coarsen",
      },
      {
        onSuccess: (data) => {
          // Strictly-newer rather than equal, so an answer already on screen
          // is never replaced by an older one that resolved late.
          setAnswer((current) =>
            current !== null && current.sequence > sequence
              ? current
              : { sequence, result: data },
          );
        },
      },
    );
  }, [
    chartQuery.data,
    requestKey,
    mutate,
    chartId,
    projectId,
    start,
    end,
    step,
  ]);

  const result = answer?.result;

  const columns = useMemo(
    () => (result?.columns ?? []) as readonly LangWatchQLDatasetColumn[],
    [result],
  );

  if (chartQuery.error) {
    return <HandledErrorAlert error={chartQuery.error} />;
  }

  if (run.error) {
    return <HandledErrorAlert error={run.error} />;
  }

  if (!chartQuery.data || !result) {
    return (
      <HStack gap={2} color="fg.muted" padding={4}>
        <Spinner size="sm" />
        <Text fontSize="13px">Loading the chart</Text>
      </HStack>
    );
  }

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
          {...(chartQuery.data.definition.vegaLiteSpec
            ? { vegaLiteSpec: chartQuery.data.definition.vegaLiteSpec }
            : {})}
          ariaLabel={name}
        />
      </Box>
    </VStack>
  );
}
