/**
 * The boundary that keeps Vega out of the dashboard bundle.
 *
 * The dashboard route is loaded by every member who opens Reports, whether or
 * not any workbench chart is placed on it. Vega, Vega-Lite, vega-embed and the
 * generated schema validator are several megabytes that only a grid actually
 * containing a workbench widget ever needs, so everything that reaches them is
 * behind this one lazy import.
 *
 * Mount this, not `LangWatchQLWidgetChart` — importing that directly is what
 * would put Vega back in the dashboard's entry chunk, and nothing would look
 * wrong. The sibling boundary for the workbench is
 * `LazyLangWatchQLChartMode.tsx`; they are separate because the two surfaces
 * mount different components, not because the chunk differs.
 *
 * Type re-exports below are type-only, so they are erased at build and pull
 * nothing eagerly.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";

import dynamic from "~/utils/compat/next-dynamic";

import type { LangWatchQLWidgetChartProps } from "./LangWatchQLWidgetChart";

export type { LangWatchQLWidgetChartProps } from "./LangWatchQLWidgetChart";

export const LazyLangWatchQLWidgetChart = dynamic<LangWatchQLWidgetChartProps>(
  () => import("./LangWatchQLWidgetChart"),
  {
    ssr: false,
    loading: () => (
      <HStack gap={2} color="fg.muted" padding={4}>
        <Spinner size="sm" />
        <Text fontSize="13px">Loading the chart</Text>
      </HStack>
    ),
  },
);
