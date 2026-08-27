/**
 * The top line of an open run plan: which run is on screen on the left, and
 * everything a person can do with the plan on the right, all on one row.
 *
 * The name of the plan is not here: it reads as the page title while the plan
 * is open, so this line can stay on the run itself.
 *
 * A set that runs from code is not a plan anyone wrote, so it carries neither
 * "Edit run plan" nor Run. Export lives in the overflow menu, so the line ends
 * on the two actions the prototype draws.
 *
 * "Show run settings" turns on the block under this line that says what the
 * run was configured with. It is off until it is asked for, so nothing pushes
 * the results down on a page a person opened to read them.
 *
 * How long ago the run started is not on this line. The runs rail beside it
 * already says that for every run, and the settings block says it again with
 * the date, so a third copy on the line the results start from says nothing
 * new.
 *
 * The back control is not here: it lives in the runs rail, beside the list it
 * goes back to.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import {
  Download,
  MoreVertical,
  Pencil,
  Play,
  Settings2,
  Square,
} from "lucide-react";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import type { RunGroupSummary } from "~/components/suites/run-history-transforms";
import { Menu } from "~/components/ui/menu";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import { ToggleButton } from "../shared/ToggleButton";
import type { AgentTestingViewMode } from "../useAgentTestingStore";
import type { RunPlan } from "./run-plans";
import { ViewModeToggle } from "./ViewModeToggle";

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
 *
 * How it went reads beside the name, where a person looks first.
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
  isRunSettingsShown,
  onToggleRunSettings,
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
