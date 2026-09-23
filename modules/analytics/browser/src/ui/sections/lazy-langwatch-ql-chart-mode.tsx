/**
 * The boundary that keeps Vega out of every bundle but this one — only a
 * member opening Chart mode needs those megabytes. Mount this, not the
 * chart-mode module directly, or Vega lands back in the entry chunk unnoticed.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";
import { lazy } from "react";

import { lazyBoundary } from "../elements/lazy-boundary.tsx";
import type { LangWatchQLChartModeProps } from "./themed-langwatch-ql-chart-mode.tsx";

export type {
  LangWatchQLChartModeProps,
  LangWatchQLChartResult,
} from "./themed-langwatch-ql-chart-mode.tsx";

export const LazyLangWatchQLChartMode = lazyBoundary<LangWatchQLChartModeProps>(
  lazy(() => import("./themed-langwatch-ql-chart-mode.tsx")),
  () => (
    <HStack gap={2} color="fg.muted" padding={4}>
      <Spinner size="sm" />
      <Text fontSize="13px">Loading the chart</Text>
    </HStack>
  ),
);
