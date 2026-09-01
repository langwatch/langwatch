/**
 * The runs of one run plan, newest first: the number of the run, the note the
 * person left with it, how long ago it started and how it went.
 *
 * The way back and the run list, and nothing else. The name of the plan reads
 * as the page title while the plan is open, so repeating it here would say the
 * same thing twice on one screen.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { NewSimulationsCallout } from "~/components/suites/NewSimulationsCallout";
import { FG_MUTED } from "../shared/design";
import { AgentTestingPeriodPicker } from "../shared/PeriodPicker";
import type { PeriodControls } from "./period-controls";
import { RunsSidebarBatchEntry } from "./RunsSidebarBatchEntry";
import { RunsSidebarEntry } from "./RunsSidebarEntry";
import type { RunPlanBatches } from "./useRunPlanBatches";

export const RUNS_SIDEBAR_WIDTH = 230;

export type RunsSidebarProps = {
  runs: Pick<
    RunPlanBatches,
    "batchRuns" | "totalBatchCount" | "hasMore" | "loadMore" | "isLoading"
  >;
  selectedBatchRunId: string | null;
  /**
   * A run of this plan that has no rows yet: one just started from this page,
   * or one the address names before its first scenario has reported.
   */
  pendingBatchRunId: string | null;
  onSelectRun: (batchRunId: string) => void;
  onBack: () => void;
  periodControls: PeriodControls;
};

function PendingEntry() {
  return (
    <RunsSidebarEntry
      title="Starting"
      note={null}
      timeAgo="now"
      passRate={null}
      passedCount={null}
      isSelected={false}
      isPending
      testId="runs-sidebar-pending"
    />
  );
}

function RunsList({
  runs,
  selectedBatchRunId,
  onSelectRun,
  isPendingShown,
}: Pick<RunsSidebarProps, "runs" | "selectedBatchRunId" | "onSelectRun"> & {
  isPendingShown: boolean;
}) {
  const { batchRuns, isLoading, hasMore, loadMore, totalBatchCount } = runs;
  const isEmptyShown = !isLoading && batchRuns.length === 0 && !isPendingShown;

  return (
    <>
      {batchRuns.map((batch, index) => (
        <RunsSidebarBatchEntry
          key={batch.batchRunId}
          batch={batch}
          index={index}
          totalBatchCount={totalBatchCount}
          loadedCount={batchRuns.length}
          isSelected={selectedBatchRunId === batch.batchRunId}
          onSelect={onSelectRun}
        />
      ))}

      {isEmptyShown ? (
        <Text fontSize="11.5px" color={FG_MUTED} paddingX={1} paddingTop={2}>
          No run in this period.
        </Text>
      ) : null}

      {hasMore ? (
        <Button
          size="xs"
          variant="ghost"
          height="26px"
          fontSize="11.5px"
          color={FG_MUTED}
          justifyContent="flex-start"
          paddingX={3}
          onClick={loadMore}
        >
          Load More...
        </Button>
      ) : null}
    </>
  );
}

export function RunsSidebar({
  runs,
  selectedBatchRunId,
  pendingBatchRunId,
  onSelectRun,
  onBack,
  periodControls,
}: RunsSidebarProps) {
  const isPendingShown =
    !!pendingBatchRunId &&
    !runs.batchRuns.some((batch) => batch.batchRunId === pendingBatchRunId);

  return (
    <VStack
      align="stretch"
      gap={1}
      width={`${RUNS_SIDEBAR_WIDTH}px`}
      flexShrink={0}
      height="full"
      paddingX={3}
      paddingY={4}
      data-testid="agent-testing-runs-sidebar"
    >
      <Button
        size="xs"
        variant="ghost"
        height="28px"
        fontSize="12px"
        fontWeight="medium"
        color={FG_MUTED}
        justifyContent="flex-start"
        paddingX="10px"
        marginBottom={1}
        onClick={onBack}
      >
        <ArrowLeft size={13} /> Results
      </Button>

      {/* Only the list scrolls: the announcement and the period picker stay
          in reach however long the run history grows. */}
      <VStack align="stretch" gap={1} flex={1} minHeight={0} overflow="auto">
        {isPendingShown ? <PendingEntry /> : null}

        <RunsList
          runs={runs}
          selectedBatchRunId={selectedBatchRunId}
          onSelectRun={onSelectRun}
          isPendingShown={isPendingShown}
        />
      </VStack>

      <NewSimulationsCallout target="runs" />

      <Box paddingLeft={1} paddingTop={4}>
        <AgentTestingPeriodPicker
          period={periodControls.period}
          setRelativePeriod={periodControls.setRelativePeriod}
          compact
        />
      </Box>
    </VStack>
  );
}
