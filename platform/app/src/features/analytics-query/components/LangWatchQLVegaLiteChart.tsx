import {
  LangWatchQLVegaLiteChart as PackageChart,
  type LangWatchQLDataset,
  type LangWatchQLDatasetColumn,
} from "@langwatch/analytics-web/chart";

import {
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "@langwatch/analytics-web/visualization";

import { useLangwatchVegaTokens } from "../hooks/useLangwatchVegaTokens";

export interface LangWatchQLVegaLiteChartProps {
  readonly spec: unknown;
  readonly datasets: Readonly<Record<string, LangWatchQLDataset>>;
  readonly columnsByDataset: Readonly<
    Record<string, readonly LangWatchQLDatasetColumn[]>
  >;
  readonly ariaLabel?: string;
}

export function LangWatchQLVegaLiteChart(props: LangWatchQLVegaLiteChartProps) {
  const { colorMode, tokens } = useLangwatchVegaTokens();

  return (
    <PackageChart
      {...props}
      themeConfig={langwatchVegaConfig({ colorMode, tokens })}
      pinnedConfig={langwatchVegaPinnedConfig({ tokens })}
      colorMode={colorMode}
    />
  );
}
