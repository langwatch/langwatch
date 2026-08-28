/**
 * One run of the plan in the runs rail, read from the rows the run produced.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import {
  type BatchRun,
  computeBatchRunSummary,
} from "~/components/suites/run-history-transforms";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { RunsSidebarEntry } from "./RunsSidebarEntry";
import { batchNote } from "./run-plans";
import { runTitle } from "./run-titles";

export type RunsSidebarBatchEntryProps = {
  batch: BatchRun;
  /** Where the run sits in the window, which gives it its number. */
  index: number;
  totalBatchCount: number | null;
  loadedCount: number;
  isSelected: boolean;
  onSelect: (batchRunId: string) => void;
};

export function RunsSidebarBatchEntry({
  batch,
  index,
  totalBatchCount,
  loadedCount,
  isSelected,
  onSelect,
}: RunsSidebarBatchEntryProps) {
  const now = useNow();
  const summary = computeBatchRunSummary({ batchRun: batch });
  const isRunning = summary.inProgressCount + summary.queuedCount > 0;

  return (
    <RunsSidebarEntry
      title={runTitle({
        index,
        totalCount: totalBatchCount,
        loadedCount,
      })}
      note={batchNote(batch.scenarioRuns)}
      timeAgo={formatTimeAgoCompact(batch.timestamp, now)}
      passRate={summary.passRate}
      passedCount={summary.passedCount}
      isRunning={isRunning}
      judgedCount={summary.completedCount}
      totalCount={summary.totalCount}
      isSelected={isSelected}
      onClick={() => onSelect(batch.batchRunId)}
      testId={`runs-sidebar-item-${batch.batchRunId}`}
    />
  );
}
