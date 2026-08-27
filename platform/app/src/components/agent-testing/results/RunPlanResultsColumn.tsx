/**
 * The page beside the runs rail: what the selected run is called, how to read
 * it, and the results themselves.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ContentColumn } from "../shared/ContentColumn";
import type { PeriodControls } from "./period-controls";
import type { RunPlanDetailProps } from "./RunPlanDetail";
import { RunPlanDetailHeader } from "./RunPlanDetailHeader";
import { RunPlanResultsDialogs } from "./RunPlanResultsDialogs";
import { RunPlanRunResults } from "./RunPlanRunResults";
import { RunSettingsBlock } from "./RunSettingsBlock";
import { RUNS_SIDEBAR_WIDTH } from "./RunsSidebar";
import type { RunPlan } from "./run-plans";
import type { RunPlanBatches, RunPlanSelection } from "./useRunPlanBatches";
import { useRunPlanResultsColumn } from "./useRunPlanResultsColumn";

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
    runSettings,
    runStartedLabel,
    isRunSettingsShown,
    toggleRunSettings,
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
          isRunSettingsShown={isRunSettingsShown}
          onToggleRunSettings={toggleRunSettings}
        />

        {isRunSettingsShown && runSettings ? (
          <RunSettingsBlock
            settings={runSettings}
            startedLabel={runStartedLabel}
          />
        ) : null}

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
