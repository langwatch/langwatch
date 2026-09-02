/**
 * The page beside the runs rail: what the selected run is called, how to read
 * it, and the results themselves.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ContentColumn } from "../shared/content-column";
import type { PeriodControls } from "./period-controls";
import type { RunPlanDetailProps } from "./run-plan-detail";
import { RunPlanDetailHeader } from "./run-plan-detail-header";
import { RunPlanResultsDialogs } from "./run-plan-results-dialogs";
import { RunPlanRunResults } from "./run-plan-run-results";
import { RUNS_SIDEBAR_WIDTH } from "./runs-sidebar";
import type { RunPlan } from "./run-plans";
import type { RunPlanBatches, RunPlanSelection } from "./use-run-plan-batches";
import { useRunPlanResultsColumn } from "./use-run-plan-results-column";

export type RunPlanResultsColumnProps = {
  plan: RunPlan;
  batches: RunPlanBatches;
  selection: RunPlanSelection;
  periodControls: PeriodControls;
  onEditPlan: RunPlanDetailProps["onEditPlan"];
};

export function RunPlanResultsColumn({
  plan,
  batches,
  selection,
  periodControls,
  onEditPlan,
}: RunPlanResultsColumnProps) {
  const {
    canManage,
    viewMode,
    onViewModeChange,
    cancel,
    exportRuns,
    isExportDisabled,
    run,
    runDialog,
  } = useRunPlanResultsColumn({ plan, batches, selection, periodControls });

  return (
    <>
      <ContentColumn railWidth={RUNS_SIDEBAR_WIDTH}>
        <RunPlanDetailHeader
          plan={plan}
          run={run}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          onStopAll={
            cancel.canStop && selection.isBatchRunning
              ? cancel.handleCancelAll
              : undefined
          }
          isStoppingAll={cancel.isCancellingBatch}
          onExport={exportRuns.openExportDialog}
          isExportDisabled={isExportDisabled}
          onEditPlan={onEditPlan}
          onRunPlan={canManage ? runDialog.runPlan : undefined}
        />

        <RunPlanRunResults
          plan={plan}
          batches={batches}
          selection={selection}
          cancel={cancel}
          viewMode={viewMode}
          periodControls={periodControls}
          onRerunCase={canManage ? runDialog.rerunCase : undefined}
        />
      </ContentColumn>

      <RunPlanResultsDialogs
        exportRuns={exportRuns}
        runDialog={runDialog}
        runCount={batches.allRuns.length}
      />
    </>
  );
}
