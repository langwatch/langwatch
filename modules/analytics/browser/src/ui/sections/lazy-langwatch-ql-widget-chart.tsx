/**
 * The boundary that keeps Vega out of the dashboard bundle: those
 * megabytes would load for every Reports member regardless of whether a
 * workbench chart is on the page. Mount this, not the widget-chart module.
 * @see specs/lwql/saved-charts.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";

import { lazyBoundary } from "../elements/lazy-boundary.tsx";
import type { LangWatchQLWidgetChartProps } from "./langwatch-ql-widget-chart.tsx";

export type { LangWatchQLWidgetChartProps } from "./langwatch-ql-widget-chart.tsx";

export const LazyLangWatchQLWidgetChart = lazyBoundary<LangWatchQLWidgetChartProps>(
  () => import("./langwatch-ql-widget-chart.tsx"),
  () => (
    <HStack gap={2} color="fg.muted" padding={4}>
      <Spinner size="sm" />
      <Text fontSize="13px">Loading the chart</Text>
    </HStack>
  ),
);
