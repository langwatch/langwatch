import {
  LangWatchQLChartMode as PackageChartMode,
  type LangWatchQLChartResult,
} from "@langwatch/analytics-web/chart";

import {
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "@langwatch/analytics-web/visualization";

import { useLangwatchVegaTokens } from "../hooks/useLangwatchVegaTokens";

export type { LangWatchQLChartResult } from "@langwatch/analytics-web/chart";

export interface LangWatchQLChartModeProps {
  readonly result: LangWatchQLChartResult;
  readonly submittedLabel?: string;
  readonly view?: "chart" | "specification";
  readonly onOpenSpecification?: () => void;
  readonly editedSpecText: string | null;
  readonly onEditedSpecTextChange: (text: string | null) => void;
  readonly registerSpecReader?: (
    read: (() => Record<string, unknown> | undefined) | null,
  ) => void;
}

export function LangWatchQLChartMode(props: LangWatchQLChartModeProps) {
  const { colorMode, tokens } = useLangwatchVegaTokens();
  const themeConfig = langwatchVegaConfig({ colorMode, tokens });
  const pinnedConfig = langwatchVegaPinnedConfig({ tokens });

  return (
    <PackageChartMode
      {...props}
      themeConfig={themeConfig}
      pinnedConfig={pinnedConfig}
      colorMode={colorMode}
    />
  );
}

export default LangWatchQLChartMode;
