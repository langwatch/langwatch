/**
 * Chart mode, wearing this deployment's theme.
 *
 * `platform/app/src/features/analytics-query/components/LangWatchQLChartMode.tsx`,
 * which was one of the app adapters that gave the portable chart its colours.
 * The adapter comes into the package with the surface it served, and it stays a
 * separate module for the reason it always was one: the chart itself takes a
 * resolved theme, so it can be rendered in a test without a Chakra token
 * provider, and only this file knows where the tokens come from.
 */

import {
  LangWatchQLChartMode as ChartMode,
  type LangWatchQLChartResult,
} from "./langwatch-ql-chart-mode";
import { langwatchVegaConfig, langwatchVegaPinnedConfig } from "../../model/visualization";
import { useLangwatchVegaTokens } from "../../behavior/use-langwatch-vega-tokens";

export type { LangWatchQLChartResult };

export interface LangWatchQLChartModeProps {
  readonly result: LangWatchQLChartResult;
  readonly submittedLabel?: string;
  readonly view?: "chart" | "specification";
  readonly onOpenSpecification?: () => void;
  readonly editedSpecText: string | null;
  readonly onEditedSpecTextChange: (text: string | null) => void;
  readonly registerSpecReader?: (read: (() => Record<string, unknown> | undefined) | null) => void;
}

export function ThemedLangWatchQLChartMode(props: LangWatchQLChartModeProps) {
  const { colorMode, tokens } = useLangwatchVegaTokens();

  return (
    <ChartMode
      {...props}
      themeConfig={langwatchVegaConfig({ colorMode, tokens })}
      pinnedConfig={langwatchVegaPinnedConfig({ tokens })}
      colorMode={colorMode}
    />
  );
}

export default ThemedLangWatchQLChartMode;
