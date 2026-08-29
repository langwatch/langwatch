/**
 * Every way into a recent run of the Scenarios tab: the button above the table,
 * the submenu of a row menu, and the button in the scenario editor.
 *
 * All three read one list, so a run reads the same and opens the same wherever
 * it is reached from. What changes between them is the scope: the open set, one
 * test suite, or one scenario.
 *
 * A row holds the run plan the run belongs to, how long ago it started and how
 * it did, and nothing more. The whole point is to reach a run in one click, so
 * the list stays scannable and the results themselves stay on the Results tab.
 *
 * The button is offered when the set has a scenario that ran inside the
 * period, which is the one question the list itself answers, so the control is
 * never offered over an empty list and never hidden over a full one.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Box, type ButtonProps, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Period } from "~/components/PeriodSelector";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { FG_MUTED } from "../shared/design";
import { formatPassRate, passRateColor } from "../shared/pass-rate-color";
import { SmallButton } from "../shared/SmallButton";
import { MENU_ACTION_ICONS, MenuActionLabel } from "./MenuActionLabel";
import { useOpenPlanRun } from "./useOpenPlanRun";
import { type RecentRun, useSuiteRecentRuns } from "./useSuiteRecentRuns";

/** What the button reads. */
export const OPEN_RECENT_RUN_LABEL = "Open recent run";

/** What the submenu of a row menu reads. */
export const OPEN_RECENT_RUNS_LABEL = "Open recent runs";

/** What a run that still has scenarios to judge reads in place of a rate. */
export const RUNNING_RUN_LABEL = "running";

export type RecentRunsMenuProps = {
  period: Period;
  /** The scenarios filed under the set, which are what its runs covered. */
  scenarioIds: string[];
  /**
   * False when no scenario of the scope ran inside the period, so there is
   * nothing to open.
   */
  hasRun: boolean;
  /**
   * What the tooltip says while there is nothing to open. A caller that gives
   * one keeps the button on screen and turns it off; a caller that gives none
   * drops the button, which is what the line above the table does.
   */
  emptyHint?: string;
  /** Called once a run is chosen, for a caller that must close itself first. */
  onChosen?: () => void;
};

/** One run, as one row: the run plan, the time, the result. */
function RecentRunRow({
  run,
  onOpen,
}: {
  run: RecentRun;
  onOpen: (run: RecentRun) => void;
}) {
  const now = useNow();

  return (
    <Menu.Item
      value={run.batchRunId}
      onClick={() => onOpen(run)}
      data-testid={`recent-run-${run.batchRunId}`}
    >
      <HStack gap={2} width="full">
        <Text fontSize="12px" fontWeight="medium" truncate minWidth={0}>
          {run.planName}
        </Text>
        <Text fontSize="11px" color={FG_MUTED}>
          {formatTimeAgoCompact(run.timestamp, now)}
        </Text>
        <Box flex={1} />
        {run.isRunning ? (
          <Text fontSize="11px" color={FG_MUTED}>
            {RUNNING_RUN_LABEL}
          </Text>
        ) : (
          <Text
            fontSize="11px"
            fontWeight="semibold"
            color={passRateColor(run.passRate)}
          >
            {formatPassRate(run.passRate)}
          </Text>
        )}
      </HStack>
    </Menu.Item>
  );
}

/** What the list holds while it has no rows to hold. */
function RecentRunsNote({ children }: { children: string }) {
  return (
    <Text fontSize="11.5px" color={FG_MUTED} paddingX={3} paddingY={2}>
      {children}
    </Text>
  );
}

function RecentRunsList({
  period,
  scenarioIds,
  isOpen,
  onChosen,
}: RecentRunsMenuProps & { isOpen: boolean }) {
  const { runs, isLoading } = useSuiteRecentRuns({
    scenarioIds,
    period,
    enabled: isOpen,
  });
  const openPlanRun = useOpenPlanRun();

  if (isLoading) return <RecentRunsNote>Reading the runs...</RecentRunsNote>;
  if (runs.length === 0) {
    return <RecentRunsNote>No run in this period.</RecentRunsNote>;
  }

  return (
    <>
      {runs.map((run) => (
        <RecentRunRow
          key={run.batchRunId}
          run={run}
          onOpen={(chosen) => {
            openPlanRun({
              planSlug: chosen.planSlug,
              batchRunId: chosen.batchRunId,
            });
            onChosen?.();
          }}
        />
      ))}
    </>
  );
}

/**
 * The button itself, which reads the same whether it is on or off.
 *
 * It spreads what it is given: as the trigger of the menu it is handed the
 * click, the ref and the aria state, and dropping them leaves a button that
 * opens nothing.
 */
function RecentRunsTrigger(props: ButtonProps) {
  return (
    <SmallButton {...props} data-testid="recent-runs-trigger">
      <Icon as={MENU_ACTION_ICONS.openRecentRuns} boxSize="13px" />
      {OPEN_RECENT_RUN_LABEL}
      <ChevronDown size={13} />
    </SmallButton>
  );
}

export function RecentRunsMenu(props: RecentRunsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!props.hasRun) {
    if (!props.emptyHint) return null;

    return (
      <Tooltip content={props.emptyHint}>
        {/* A disabled button dispatches no pointer event, so the tooltip would
            never fire; the span is what the hover lands on. */}
        <Box as="span" display="inline-flex">
          <RecentRunsTrigger disabled />
        </Box>
      </Tooltip>
    );
  }

  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={({ open }: { open: boolean }) => setIsOpen(open)}
    >
      <Menu.Trigger asChild>
        <RecentRunsTrigger />
      </Menu.Trigger>
      <Menu.Content minWidth="240px" data-testid="recent-runs-list">
        <RecentRunsList {...props} isOpen={isOpen} />
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * The same list, as a submenu of a row menu.
 *
 * A row menu offered "Open last run", which reached one run and said nothing
 * about the rest. The submenu offers the same runs the button above the table
 * offers, narrowed to the row it hangs off, so a row menu and the line above
 * the table answer the same question the same way.
 *
 * The runs are read only once the submenu is opened, so a menu that nobody
 * opens this far downloads nothing.
 */
export function RecentRunsSubmenu({
  period,
  scenarioIds,
}: Pick<RecentRunsMenuProps, "period" | "scenarioIds">) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Menu.Root
      positioning={{ placement: "right-start", gutter: 2 }}
      onOpenChange={({ open }: { open: boolean }) => setIsOpen(open)}
    >
      <Menu.TriggerItem value="open-recent-runs">
        <MenuActionLabel action="openRecentRuns">
          {OPEN_RECENT_RUNS_LABEL}
        </MenuActionLabel>
      </Menu.TriggerItem>
      <Menu.Content minWidth="240px" data-testid="recent-runs-list">
        <RecentRunsList
          period={period}
          scenarioIds={scenarioIds}
          hasRun
          isOpen={isOpen}
        />
      </Menu.Content>
    </Menu.Root>
  );
}
