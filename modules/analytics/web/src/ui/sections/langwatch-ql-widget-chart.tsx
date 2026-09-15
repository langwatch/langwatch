/**
 * The chart half of a dashboard widget, behind the Vega boundary. Split
 * from the widget so nothing Vega-Lite loads until it has rows to draw —
 * mount via `LazyLangWatchQLWidgetChart`, never import this directly, or
 * megabytes of Vega land back in the entry chunk. Validation isn't
 * repeated here — {@link LangWatchQLVegaLiteChart} refuses on its own.
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { Box } from "@chakra-ui/react";
import { useMemo } from "react";

import {
  type LangWatchQLDatasetColumn,
  LWQL_QUERY_RESULT_DATASET,
} from "@langwatch/analytics-contract/visualization";
import { starterVegaLiteSpec } from "@langwatch/analytics-contract/visualization";

import { ThemedLangWatchQLVegaLiteChart } from "./themed-langwatch-ql-vega-lite-chart.tsx";

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
    () => vegaLiteSpec ?? starterVegaLiteSpec({ columns, datasetName: LWQL_QUERY_RESULT_DATASET }),
    [vegaLiteSpec, columns],
  );

  return (
    <Box height="full" width="full" minWidth={0}>
      <ThemedLangWatchQLVegaLiteChart
        spec={spec}
        datasets={{ [LWQL_QUERY_RESULT_DATASET]: rows }}
        columnsByDataset={{ [LWQL_QUERY_RESULT_DATASET]: columns }}
        ariaLabel={ariaLabel}
      />
    </Box>
  );
}

export default LangWatchQLWidgetChart;
