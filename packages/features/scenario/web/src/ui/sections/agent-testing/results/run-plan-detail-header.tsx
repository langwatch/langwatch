/**
 * The top line of an open run plan: which run is on screen on the left, and everything a person can do with the plan on the right, all on one row.
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Download, MoreVertical, Pencil, Play, Square, Settings2 } from "lucide-react";
import { type RunGroupSummary, RunMetricsSummary } from "@langwatch/suite-web";
import { Menu } from "@langwatch/design-system/menu";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";
import { SmallButton } from "../../../elements/agent-testing/shared/small-button";
import type { AgentTestingViewMode } from "../use-agent-testing-store";
import type { RunPlan } from "../../../../behavior/agent-testing/results/run-plans";
import { ViewModeToggle } from "./view-mode-toggle";
import { ToggleButton } from "../../../elements/agent-testing/shared/toggle-button";

/**
 * What the run control reads.
 */
export const RUN_AGAIN_LABEL = "Run again";

/** Which run is on screen, as the line reads it. */
export type RunPlanDetailRun = {
  title: string;
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
  /** Whether the run settings block reads under this line. */
  isRunSettingsShown: boolean;
  onToggleRunSettings: () => void;
};

/**
 * Which run is on screen: its number, how it went and the note it carries.
 */
function RunSummary({ run }: { run: RunPlanDetailRun }) {
  return (
    <HStack gap={2.5} flex="1" data-testid="run-summary-run">
      <Text fontSize="12.5px" fontWeight="semibold" flexShrink={0}>
        {run.title}
      </Text>
      {run.summary ? (
        <Box flexShrink={0}>
          <RunMetricsSummary summary={run.summary} size="md" />
        </Box>
      ) : null}
      {run.note ? (
        <Text
          fontSize="11.5px"
          color={FG_MUTED}
          fontStyle="italic"
          truncate
          // A width of zero that grows: the note asks the line for nothing and
          // takes whatever the run number, the pass block and the actions
          // leave. Without it the line counts the whole note and breaks in two
          // rather than cutting the note short.
          flex="1 1 0"
          width={0}
          minWidth={0}
          title={run.note}
          data-testid="run-summary-note"
        >
          &ldquo;{run.note}&rdquo;
        </Text>
      ) : null}
    </HStack>
  );
}

/**
 * Everything a person can do with the plan, in one group that never gives up
 * space. The group keeps its width whatever the run summary beside it says, so
 * the actions sit in the same place on every run of every plan.
 */
function HeaderActions({
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
  isRunSettingsShown,
  onToggleRunSettings,
}: RunPlanDetailHeaderProps) {
  const suiteId = plan.kind === "suite" ? plan.suiteId : null;

  return (
    <HStack gap={1.5} flexShrink={0} data-testid="run-summary-actions">
      {run ? (
        <ToggleButton
          isOn={isRunSettingsShown}
          onClick={onToggleRunSettings}
          data-testid="run-settings-toggle"
        >
          <Settings2 size={13} /> Show run settings
        </ToggleButton>
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
          data-testid="edit-run-plan-button"
        >
          <Pencil size={13} /> Edit run plan
        </Button>
      ) : null}

      {onRunPlan && suiteId ? (
        <SmallButton
          variant="solid"
          colorPalette="blue"
          height="32px"
          minHeight="32px"
          onClick={onRunPlan}
          data-testid="run-plan-button"
        >
          <Play size={13} /> {RUN_AGAIN_LABEL}
        </SmallButton>
      ) : null}
    </HStack>
  );
}

export function RunPlanDetailHeader(props: RunPlanDetailHeaderProps) {
  return (
    <HStack
      gap={2.5}
      flexWrap="wrap"
      justify="flex-end"
      minHeight="32px"
      data-testid="run-summary-line"
    >
      {props.run ? <RunSummary run={props.run} /> : <Box flex="1" />}
      <HeaderActions {...props} />
    </HStack>
  );
}
