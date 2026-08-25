/**
 * The top line of an open run plan: its name and what it covers on the left,
 * and on the same line everything a person can do with it.
 *
 * A set that runs from code and the one-off bucket are not plans anyone wrote,
 * so neither carries an Edit or a Run. Export lives in the overflow menu, so
 * the line ends on the two actions the prototype draws.
 *
 * The back control is not here: it lives in the runs rail, beside the list it
 * goes back to.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Download, MoreVertical, Pencil, Play, Square } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { FG_FAINT, FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { AgentTestingViewMode } from "../useAgentTestingStore";
import { planScopeNote, type RunPlan } from "./run-plans";
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
  /** Opens the run dialog on this plan. Absent when it cannot be run. */
  onRunPlan?: () => void;
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
  onRunPlan,
}: RunPlanDetailHeaderProps) {
  const suiteId = plan.kind === "suite" ? plan.suiteId : null;

  return (
    <HStack gap={2} flexWrap="wrap" minHeight="32px">
      <Text fontSize="14px" fontWeight="semibold" color="fg">
        {plan.name}
      </Text>
      <Text fontSize="11.5px" color={FG_FAINT}>
        {planScopeNote(plan.kind)}
      </Text>
      <Box flex={1} />
      <HStack gap={1.5}>
        <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />

        {onStopAll ? (
          <SmallButton
            onClick={onStopAll}
            disabled={isStoppingAll}
            data-testid="stop-all-button"
          >
            <Square size={12} /> Stop all
          </SmallButton>
        ) : null}

        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              size="xs"
              variant="ghost"
              minWidth="26px"
              height="26px"
              paddingX={0}
              color={FG_MUTED}
              aria-label={`More actions for ${plan.name}`}
            >
              <MoreVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item
              value="export"
              disabled={isExportDisabled}
              onClick={onExport}
              data-testid="export-runs-button"
            >
              <Download size={13} /> Export as CSV
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>

        {suiteId ? (
          <Button
            size="xs"
            variant="ghost"
            height="28px"
            paddingX="10px"
            fontSize="12px"
            fontWeight="medium"
            color={FG_MUTED}
            gap={1.5}
            onClick={() => onEditPlan(suiteId)}
          >
            <Pencil size={13} /> Edit
          </Button>
        ) : null}

        {onRunPlan && suiteId ? (
          <SmallButton
            variant="solid"
            colorPalette="blue"
            background={undefined}
            borderColor="transparent"
            onClick={onRunPlan}
            data-testid="run-plan-button"
          >
            <Play size={13} /> Run
          </SmallButton>
        ) : null}
      </HStack>
    </HStack>
  );
}
