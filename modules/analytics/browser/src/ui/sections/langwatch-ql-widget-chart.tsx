/**
 * The chart half of a dashboard widget, behind the Vega boundary. Mount
 * via `LazyLangWatchQLWidgetChart`, never import this directly, or
 * megabytes of Vega land in the entry chunk. Validation isn't repeated here.
 * @see specs/lwql/saved-charts.feature
 */

import { Box } from "@chakra-ui/react";
import {
  type LangWatchQLDatasetColumn,
  LWQL_QUERY_RESULT_DATASET,
  starterVegaLiteSpec,
} from "@langwatch/analytics-contract/visualization";
import { useMemo } from "react";

import { ThemedLangWatchQLVegaLiteChart } from "./themed-langwatch-ql-vega-lite-chart.tsx";

export interface LangWatchQLWidgetChartProps {
  readonly columns: readonly LangWatchQLDatasetColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /**
   * The specification saved with the chart, or `undefined` for a
   * query-alone chart — a whole record, not a broken one. A starter is
   * derived from the result shape, the same one the workbench offers.
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
