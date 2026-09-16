/**
 * A Vega-Lite chart, wearing this deployment's theme — moved from
 * `platform/app` with the surfaces it served. Same split as the chart-mode
 * adapter: the chart takes a resolved theme, and only this module resolves one.
 */

import { LangWatchQLVegaLiteChart as VegaLiteChart } from "./langwatch-ql-vega-lite-chart.tsx";
import type {
  LangWatchQLDataset,
  LangWatchQLDatasetColumn,
} from "@langwatch/analytics-contract/visualization";
import {
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "@langwatch/analytics-contract/visualization";
import { useLangwatchVegaTokens } from "../../behavior/use-langwatch-vega-tokens.ts";

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
