/**
 * The boundary that keeps Vega out of every bundle but this one. Vega, Vega-Lite, vega-embed
 * and the generated schema validator are several megabytes only a member who opens Chart mode
 * ever needs; everything that reaches them is behind this one lazy import. Mount this, not
 * the chart-mode module — importing that directly puts Vega back in the entry chunk, and
 * nothing would look wrong.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";

import { lazyBoundary } from "../elements/lazy-boundary.tsx";

import type { LangWatchQLChartModeProps } from "./themed-langwatch-ql-chart-mode.tsx";

export type {
  LangWatchQLChartModeProps,
  LangWatchQLChartResult,
} from "./themed-langwatch-ql-chart-mode.tsx";

export const LazyLangWatchQLChartMode = lazyBoundary<LangWatchQLChartModeProps>(
  () => import("./themed-langwatch-ql-chart-mode.tsx"),
  () => (
    <HStack gap={2} color="fg.muted" padding={4}>
      <Spinner size="sm" />
      <Text fontSize="13px">Loading the chart</Text>
    </HStack>
  ),
);
