/**
 * The chart half of a dashboard widget, behind the Vega boundary.
 *
 * Split from the widget for one reason: everything Vega-Lite is reached from
 * here, so the dashboard route loads none of it until a widget actually has
 * rows to draw. The widget mounts this through `LazyLangWatchQLWidgetChart`,
 * never directly — importing this module from the dashboard is what would put
 * several megabytes of Vega back in the entry chunk, and nothing would look
 * wrong.
 *
 * It holds no query hook and cannot cause a request. Validation is not repeated
 * here either: {@link LangWatchQLVegaLiteChart} validates the specification
 * against the columns it was handed and renders its own named refusal, which is
 * the behaviour a widget wants — a definition that passed the policy when it
 * was saved can stop being drawable without anyone editing it, and the honest
 * result is a refusal on that one card rather than a crash taking the grid.
 *
 * @see ./LazyLangWatchQLWidgetChart — the boundary to mount instead
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { Box } from "@chakra-ui/react";
import { useMemo } from "react";

import { LWQL_QUERY_RESULT_DATASET } from "../visualization/lwqlDatasetNames";
import { starterVegaLiteSpec } from "../visualization/starterVegaLiteSpec";
import type { LangWatchQLDatasetColumn } from "../visualization/visualization.types";

import { LangWatchQLVegaLiteChart } from "./LangWatchQLVegaLiteChart";

export interface LangWatchQLWidgetChartProps {
  readonly columns: readonly LangWatchQLDatasetColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /**
   * The specification saved with the chart, or `undefined` for a chart saved
   * as a query alone — which is a whole record, not a broken one. A starter
   * derived from the result shape is drawn for it, the same one the workbench
   * offers for such a chart.
   */
  readonly vegaLiteSpec?: Record<string, unknown>;
  /** How the chart is described to a reader who cannot see it. */
  readonly ariaLabel: string;
}

/** Draws one widget's result. */
export function LangWatchQLWidgetChart({
  columns,
  rows,
  vegaLiteSpec,
  ariaLabel,
}: LangWatchQLWidgetChartProps) {
  const spec = useMemo(
    () =>
      vegaLiteSpec ??
      starterVegaLiteSpec({ columns, datasetName: LWQL_QUERY_RESULT_DATASET }),
    [vegaLiteSpec, columns],
  );

  return (
    <Box height="full" width="full" minWidth={0}>
      <LangWatchQLVegaLiteChart
        spec={spec}
        datasets={{ [LWQL_QUERY_RESULT_DATASET]: rows }}
        columnsByDataset={{ [LWQL_QUERY_RESULT_DATASET]: columns }}
        ariaLabel={ariaLabel}
      />
    </Box>
  );
}

export default LangWatchQLWidgetChart;
