/**
 * The page beside the runs rail: what the selected run is called, how to read
 * it, and the results themselves.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ScenarioRunExportDialog } from "~/components/suites/ScenarioRunExportDialog";
import { useExportScenarioRuns } from "~/components/suites/useExportScenarioRuns";
import { useCan } from "~/hooks/useCan";
import { useNow } from "~/hooks/useNow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { RunDialog } from "../run/RunDialog";
import { ContentColumn } from "../shared/ContentColumn";
import type { PeriodControls } from "./period-controls";
import type { RunPlanDetailProps } from "./RunPlanDetail";
import {
  RunPlanDetailHeader,
  type RunPlanDetailRun,
} from "./RunPlanDetailHeader";
import { RunPlanRunResults } from "./RunPlanRunResults";
import { RUNS_SIDEBAR_WIDTH } from "./RunsSidebar";
import type { RunPlan } from "./run-plans";
import type { RunPlanBatches, RunPlanSelection } from "./useRunPlanBatches";
import { useRunPlanCancel } from "./useRunPlanCancel";
import { useRunPlanRunDialog } from "./useRunPlanRunDialog";
import { useRunPlanViewMode } from "./useRunPlanViewMode";

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
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const now = useNow();
  const canManage = can("scenarios:manage");
  const { viewMode, handleViewModeChange } = useRunPlanViewMode();
  const runDialog = useRunPlanRunDialog({ plan, canManage });

  const cancel = useRunPlanCancel({
    scenarioSetId: plan.scenarioSetId,
    selectedBatchRunId: selection.selectedBatch?.batchRunId ?? null,
    refetch: batches.refetch,
  });

  const exportRuns = useExportScenarioRuns({
    projectId: project?.id,
    scenarioSetId: plan.scenarioSetId,
    startDate: periodControls.period.startDate.getTime(),
    endDate: periodControls.period.endDate.getTime(),
  });

  const isExportDisabled =
    batches.isLoading ||
    exportRuns.isExporting ||
    batches.batchRuns.length === 0;

  const run: RunPlanDetailRun | null = selection.selectedBatch
    ? {
        title: selection.title ?? "",
        timeAgo: formatTimeAgoCompact(selection.selectedBatch.timestamp, now),
        note: selection.note,
        summary: selection.summary,
      }
    : null;

  return (
    <>
      <ContentColumn railWidth={RUNS_SIDEBAR_WIDTH}>
        <RunPlanDetailHeader
          plan={plan}
          run={run}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
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

      <ScenarioRunExportDialog
        isOpen={exportRuns.isDialogOpen}
        onClose={exportRuns.closeExportDialog}
        onExport={exportRuns.startExport}
        runCount={batches.allRuns.length}
        hasFiltersApplied={false}
      />

      {/* The dialog carries the whole target and parameter machinery, so it is
          only mounted once a person asks for a run. */}
      {runDialog.subject && (
        <RunDialog
          subject={runDialog.subject}
          onClose={runDialog.close}
          onRunStarted={runDialog.onRunStarted}
        />
      )}
    </>
  );
}
