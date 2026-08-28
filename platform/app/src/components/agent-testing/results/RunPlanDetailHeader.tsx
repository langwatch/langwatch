/**
 * The top line of an open run plan: which run is on screen on the left, and
 * everything a person can do with the plan on the right, all on one row.
 *
 * The name of the plan is not here: it reads as the page title while the plan
 * is open, so this line can stay on the run itself.
 *
 * A set that runs from code and the one-off bucket are not plans anyone wrote,
 * so neither carries an Edit or a Run. Export lives in the overflow menu, so
 * the line ends on the two actions the prototype draws.
 *
 * The back control is not here: it lives in the runs rail, beside the list it
 * goes back to.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Download, MoreVertical, Pencil, Play, Square } from "lucide-react";
import { type RunGroupSummary, RunMetricsSummary } from "@langwatch/suite-web";
import { Menu } from "@langwatch/design-system/menu";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { AgentTestingViewMode } from "../useAgentTestingStore";
import type { RunPlan } from "./run-plans";
import { ViewModeToggle } from "./ViewModeToggle";

/** Which run is on screen, as the line reads it. */
export type RunPlanDetailRun = {
  title: string;
  timeAgo: string;
  note: string | null;
  summary: RunGroupSummary | null;
};

export type RunPlanDetailHeaderProps = {
  plan: RunPlan;
  /** Absent while the plan has no run to show yet. */
  run: RunPlanDetailRun | null;
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

/**
 * Which run is on screen: its number, how it went and the note it carries.
 *
 * How it went reads beside the name, where a person looks first. The age of
 * the run reads on the other end of the line, beside the controls.
 */
function RunSummary({ run }: { run: RunPlanDetailRun }) {
  return (
    <>
      <Text fontSize="12.5px" fontWeight="semibold">
        {run.title}
      </Text>
      {run.summary ? (
        <RunMetricsSummary summary={run.summary} size="md" />
      ) : null}
      {run.note ? (
        <Text
          fontSize="11.5px"
          color={FG_MUTED}
          fontStyle="italic"
          truncate
          minWidth={0}
          title={run.note}
          data-testid="run-summary-note"
        >
          &ldquo;{run.note}&rdquo;
        </Text>
      ) : null}
    </>
  );
}

export function RunPlanDetailHeader({
  plan,
  run,
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
    <HStack
      gap={2.5}
      flexWrap="wrap"
      minHeight="32px"
      data-testid="run-summary-line"
    >
      {run ? <RunSummary run={run} /> : null}

      <Box flex={1} />

      <HStack gap={1.5}>
        {run ? (
          <Text fontSize="11.5px" color={FG_MUTED} whiteSpace="nowrap">
            {run.timeAgo}
          </Text>
        ) : null}

        <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />

        {onStopAll ? (
          <SmallButton
            height="32px"
            minHeight="32px"
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
              minWidth="28px"
              height="28px"
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
            height="32px"
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
            height="32px"
            minHeight="32px"
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
