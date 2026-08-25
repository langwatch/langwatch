/**
 * The runs of one run plan, newest first: the number of the run, the note the
 * person left with it, how long ago it started and how it went.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { FG_MUTED } from "../shared/design";
import { AgentTestingPeriodPicker } from "../shared/PeriodPicker";
import type { PeriodControls } from "./period-controls";
import { RunsSidebarBatchEntry } from "./RunsSidebarBatchEntry";
import { RunsSidebarEntry } from "./RunsSidebarEntry";
import type { RunPlan } from "./run-plans";
import type { RunPlanBatches } from "./useRunPlanBatches";

export const RUNS_SIDEBAR_WIDTH = 230;

export type RunsSidebarProps = {
  plan: RunPlan;
  runs: Pick<
    RunPlanBatches,
    "batchRuns" | "totalBatchCount" | "hasMore" | "loadMore" | "isLoading"
  >;
  selectedBatchRunId: string | null;
  /** A run of this plan that was just started and has no rows yet. */
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
  plan,
  runs,
  selectedBatchRunId,
  onSelectRun,
  isPendingShown,
}: Pick<
  RunsSidebarProps,
  "plan" | "runs" | "selectedBatchRunId" | "onSelectRun"
> & { isPendingShown: boolean }) {
  const { batchRuns, isLoading, hasMore, loadMore, totalBatchCount } = runs;
  const isEmptyShown = !isLoading && batchRuns.length === 0 && !isPendingShown;

  return (
    <>
      {batchRuns.map((batch, index) => (
        <RunsSidebarBatchEntry
          key={batch.batchRunId}
          plan={plan}
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
  plan,
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
      overflow="auto"
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
        <ArrowLeft size={13} /> Run plans
      </Button>

      {isPendingShown ? <PendingEntry /> : null}

      <RunsList
        plan={plan}
        runs={runs}
        selectedBatchRunId={selectedBatchRunId}
        onSelectRun={onSelectRun}
        isPendingShown={isPendingShown}
      />

      <Box flex={1} minHeight={4} />

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
