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
 * The line holds one row whatever the note says. The run summary takes the
 * space the actions leave and cuts the note with an ellipsis, so the actions
 * keep the same place on a run with a note and on a run without one. On a
 * window too narrow even for the actions alone the line breaks, and the
 * actions stay at its right end.
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

/**
 * What the run control reads.
 *
 * The page shows a run that already happened, of a plan that already exists,
 * so the action it offers is to run that plan once more.
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
 *
 * How it went reads beside the name, where a person looks first. The number
 * and the pass block always read in full; the note is the one part that gives
 * space back, because it is the one part a person can read in a tooltip. Once
 * the note is down to nothing the group stops at what is left, and the line
 * breaks rather than cutting the pass block in half.
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
          background={undefined}
          borderColor="transparent"
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
