/**
 * Chart mode, wearing this deployment's theme: the chart itself takes a
 * resolved theme so it can render in a test without a Chakra token provider,
 * and only this file knows where the tokens come from.
 */

import {
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "@langwatch/analytics-contract/visualization";

import { useLangwatchVegaTokens } from "../../behavior/use-langwatch-vega-tokens.ts";
import {
  LangWatchQLChartMode as ChartMode,
  type LangWatchQLChartResult,
} from "./langwatch-ql-chart-mode.tsx";

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
