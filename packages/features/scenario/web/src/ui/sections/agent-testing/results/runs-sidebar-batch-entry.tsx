/**
 * One run of the plan in the runs rail, read from the rows the run produced.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { type BatchRun, computeBatchRunSummary } from "@langwatch/suite-web";
import { useNow } from "../../../../behavior/use-now";
import { formatTimeAgoCompact } from "@langwatch/workflow-web/utils/formatTimeAgo";
import {
  RunsSidebarEntry,
  type SidebarTargetRate,
} from "../../../elements/agent-testing/results/runs-sidebar-entry";
import { batchNote } from "../../../../behavior/agent-testing/results/run-plans";
import { runTitle } from "../../../../behavior/agent-testing/results/run-titles";
import { isComparison, summaryOfTarget, useBatchTargets } from "./use-batch-targets";

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
  const targets = useBatchTargets(batch.scenarioRuns);

  const targetRates: SidebarTargetRate[] | undefined = isComparison(targets)
    ? targets.map((target) => ({
        key: target.key,
        color: target.color,
        label: target.label,
        passRate: summaryOfTarget({ scenarioRuns: batch.scenarioRuns, target }).passRate,
      }))
    : undefined;

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
      targetRates={targetRates}
      isRunning={isRunning}
      judgedCount={summary.completedCount}
      totalCount={summary.totalCount}
      isSelected={isSelected}
      onClick={() => onSelect(batch.batchRunId)}
      testId={`runs-sidebar-item-${batch.batchRunId}`}
    />
  );
}
