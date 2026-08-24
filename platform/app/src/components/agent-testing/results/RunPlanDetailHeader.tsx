/**
 * The top line of an open run plan: its name on the left, and on the same
 * line everything a person can do with it.
 *
 * The back control is not here: it lives in the runs rail, beside the list it
 * goes back to.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Download, Square } from "lucide-react";
import type { AgentTestingViewMode } from "../useAgentTestingStore";
import type { RunPlan } from "./run-plans";
import { ViewModeToggle } from "./ViewModeToggle";

export type RunPlanDetailHeaderProps = {
  plan: RunPlan;
  viewMode: AgentTestingViewMode;
  onViewModeChange: (viewMode: AgentTestingViewMode) => void;
  /** Offered only while the selected run still has cases to stop. */
  onStopAll?: () => void;
  isStoppingAll: boolean;
  onExport: () => void;
  isExportDisabled: boolean;
  onEditPlan: (suiteId: string) => void;
};

export function RunPlanDetailHeader({
  plan,
  viewMode,
  onViewModeChange,
  onStopAll,
  isStoppingAll,
  onExport,
  isExportDisabled,
  onEditPlan,
}: RunPlanDetailHeaderProps) {
  const suiteId = plan.kind === "suite" ? plan.suiteId : null;

  return (
    <HStack gap={2} flexWrap="wrap">
      <Text fontSize="sm" fontWeight="semibold">
        {plan.name}
      </Text>
      <Box flex={1} />
      <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
      {onStopAll ? (
        <Button
          size="xs"
          variant="outline"
          onClick={onStopAll}
          disabled={isStoppingAll}
          data-testid="stop-all-button"
        >
          <Square size={12} /> Stop all
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="outline"
        onClick={onExport}
        disabled={isExportDisabled}
        data-testid="export-runs-button"
      >
        <Download size={12} /> Export
      </Button>
      {suiteId ? (
        <Button size="xs" variant="ghost" onClick={() => onEditPlan(suiteId)}>
          Edit
        </Button>
      ) : null}
    </HStack>
  );
}
