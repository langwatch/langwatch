/**
 * The one control under the cases table: a way into a recent run of the open
 * test suite.
 *
 * A row holds the number of the run, how long ago it started and how it did,
 * and nothing more. The whole point is to reach a run in one click, so the
 * list stays scannable and the results themselves stay on the Results tab.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import type { Period } from "~/components/PeriodSelector";
import { Menu } from "~/components/ui/menu";
import { useNow } from "~/hooks/useNow";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { FG_MUTED } from "../shared/design";
import { formatPassRate, passRateColor } from "../shared/pass-rate-color";
import { SmallButton } from "../shared/SmallButton";
import type { TestSuiteEntry } from "./test-cases";
import { useOpenPlanRun } from "./useOpenPlanRun";
import { type RecentRun, useSuiteRecentRuns } from "./useSuiteRecentRuns";

/** What the button reads. */
export const OPEN_RECENT_RUN_LABEL = "Open recent run";

/** What a run that still has scenarios to judge reads in place of a rate. */
export const RUNNING_RUN_LABEL = "running";

export type RecentRunsMenuProps = {
  suite: TestSuiteEntry;
  period: Period;
  /** False when the suite has no run in the period, so there is nothing to open. */
  hasRun: boolean;
};

/** One run, as one row: the number, the time, the result. */
function RecentRunRow({
  run,
  onOpen,
}: {
  run: RecentRun;
  onOpen: (batchRunId: string) => void;
}) {
  const now = useNow();

  return (
    <Menu.Item
      value={run.batchRunId}
      onClick={() => onOpen(run.batchRunId)}
      data-testid={`recent-run-${run.batchRunId}`}
    >
      <HStack gap={2} width="full">
        <Text fontSize="12px" fontWeight="medium">
          Run #{run.ordinal}
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
  suite,
  period,
  isOpen,
}: RecentRunsMenuProps & { isOpen: boolean }) {
  const { runs, isLoading } = useSuiteRecentRuns({
    scenarioSetId: getSuiteSetId(suite.id),
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
          onOpen={(batchRunId) =>
            openPlanRun({ planSlug: suite.slug, batchRunId })
          }
        />
      ))}
    </>
  );
}

export function RecentRunsMenu(props: RecentRunsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!props.hasRun) return null;

  return (
    <HStack justify="flex-end" paddingX={1} paddingTop={6}>
      <Menu.Root
        open={isOpen}
        onOpenChange={({ open }: { open: boolean }) => setIsOpen(open)}
      >
        <Menu.Trigger asChild>
          <SmallButton data-testid="recent-runs-trigger">
            <History size={13} />
            {OPEN_RECENT_RUN_LABEL}
            <ChevronDown size={13} />
          </SmallButton>
        </Menu.Trigger>
        <Menu.Content minWidth="240px" data-testid="recent-runs-list">
          <RecentRunsList {...props} isOpen={isOpen} />
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}
