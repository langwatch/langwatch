/**
 * The runs of one run plan, newest first: the run number, the note left with it,
 * how long ago it started and how it went.
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { ArrowLeft } from "lucide-react";

import type { RunPlanBatches } from "../../../../behavior/agent-testing/results/use-run-plan-batches.ts";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design.ts";
import { RunsSidebarEntry } from "../../../elements/agent-testing/results/runs-sidebar-entry.tsx";
import { AgentTestingPeriodPicker } from "../../../elements/agent-testing/shared/period-picker.tsx";
import type { PeriodControls } from "./period-controls.ts";
import { RunsSidebarBatchEntry } from "./runs-sidebar-batch-entry.tsx";

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

/** Runs of the rail while they load, drawn to an entry's title and result lines. */
export function RunEntriesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <VStack key={index} align="stretch" gap={1.5} paddingX={3} paddingY={2}>
          <HStack justify="space-between">
            <Skeleton height="12px" width="52px" />
            <Skeleton height="10px" width="24px" />
          </HStack>
          <Skeleton height="10px" width="76px" />
        </VStack>
      ))}
    </>
  );
}

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
      {isLoading && batchRuns.length === 0 ? <RunEntriesSkeleton /> : null}

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
    !!pendingBatchRunId && !runs.batchRuns.some((batch) => batch.batchRunId === pendingBatchRunId);

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

      {/* Only the list scrolls: the period picker stays in reach however
          long the run history grows. */}
      <VStack align="stretch" gap={1} flex={1} minHeight={0} overflow="auto">
        {isPendingShown ? <PendingEntry /> : null}

        <RunsList
          runs={runs}
          selectedBatchRunId={selectedBatchRunId}
          onSelectRun={onSelectRun}
          isPendingShown={isPendingShown}
        />
      </VStack>

      <Box paddingLeft={1} paddingTop={4}>
        <AgentTestingPeriodPicker
          period={periodControls.period}
          periodMode={periodControls.periodMode}
          setPeriod={periodControls.setPeriod}
          setRelativePeriod={periodControls.setRelativePeriod}
          compact
        />
      </Box>
    </VStack>
  );
}
