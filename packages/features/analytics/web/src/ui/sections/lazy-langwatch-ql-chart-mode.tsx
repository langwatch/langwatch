/**
 * The boundary that keeps Vega out of every bundle but this one.
 *
 * Vega, Vega-Lite, vega-embed and the generated schema validator are several
 * megabytes that only a member who opens Chart mode ever needs. Everything that
 * reaches them is behind this one lazy import, so the workbench page, Table
 * mode, and every unrelated route load none of it.
 *
 * Mount this, not the chart-mode module — importing that directly is what
 * would put Vega back in the entry chunk, and nothing would look wrong.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";

import { lazyBoundary } from "../elements/lazy-boundary";

import type { LangWatchQLChartModeProps } from "./themed-langwatch-ql-chart-mode";

export type {
  LangWatchQLChartModeProps,
  LangWatchQLChartResult,
} from "./themed-langwatch-ql-chart-mode";

export const LazyLangWatchQLChartMode = lazyBoundary<LangWatchQLChartModeProps>(
  () => import("./themed-langwatch-ql-chart-mode"),
  () => (
    <HStack gap={2} color="fg.muted" padding={4}>
      <Spinner size="sm" />
      <Text fontSize="13px">Loading the chart</Text>
    </HStack>
  ),
);
