/**
 * A Vega-Lite chart, wearing this deployment's theme.
 *
 * `platform/app/src/features/analytics-query/components/LangWatchQLVegaLiteChart.tsx`,
 * moved with the surfaces it served. Same split as the chart-mode adapter
 * beside it: the chart takes a resolved theme and this is the only module that
 * knows how to resolve one.
 */

import { LangWatchQLVegaLiteChart as VegaLiteChart } from "./langwatch-ql-vega-lite-chart";
import type {
  LangWatchQLDataset,
  LangWatchQLDatasetColumn,
} from "@langwatch/analytics-contract/visualization";
import {
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "@langwatch/analytics-contract/visualization";
import { useLangwatchVegaTokens } from "../../behavior/use-langwatch-vega-tokens";

export interface LangWatchQLVegaLiteChartProps {
  readonly spec: unknown;
  readonly datasets: Readonly<Record<string, LangWatchQLDataset>>;
  readonly columnsByDataset: Readonly<Record<string, readonly LangWatchQLDatasetColumn[]>>;
  readonly ariaLabel?: string;
}

export function ThemedLangWatchQLVegaLiteChart(props: LangWatchQLVegaLiteChartProps) {
  const { colorMode, tokens } = useLangwatchVegaTokens();

  return (
    <VegaLiteChart
      {...props}
      themeConfig={langwatchVegaConfig({ colorMode, tokens })}
      pinnedConfig={langwatchVegaPinnedConfig({ tokens })}
      colorMode={colorMode}
    />
  );
}
