/**
 * Shared status icon for run group summaries (batch, scenario, or target).
 *
 * Used by both RunRow and GroupRow headers.
 */

import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { STATUS_ICON_CONFIG } from "./status-icons";
import type { RunGroupSummary } from "./run-history-transforms";
import { worstStatus } from "./run-history-transforms";

export function SummaryStatusIcon({ summary }: { summary: RunGroupSummary }) {
  const status = worstStatus(summary);
  const config = SCENARIO_RUN_STATUS_CONFIG[status];
  const iconConfig = STATUS_ICON_CONFIG[status];
  const Icon = iconConfig.icon;
  return (
    <Icon
      size={14}
      color={`var(--chakra-colors-${config.colorPalette}-500)`}
      style={iconConfig.animate ? { animation: "spin 2s linear infinite" } : undefined}
    />
  );
}
