/**
 * The results of the selected run: a table by default, or the classic wall of
 * live conversation cards. Which run this is reads in the header line above,
 * so the results start straight away.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import type { BatchRun } from "~/components/suites/run-history-transforms";
import { ScenarioRunContent } from "~/components/suites/ScenarioRunContent";
import { useCan } from "~/hooks/useCan";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { PeriodControls } from "./period-controls";
import {
  NoRunInPeriod,
  RunsLoadError,
  RunsLoadingSkeleton,
} from "./RunPlanResultsStates";
import { RunResultsTable } from "./RunResultsTable";
import type { RunPlan } from "./run-plans";
import type { RunPlanBatches, RunPlanSelection } from "./useRunPlanBatches";
import type { useRunPlanCancel } from "./useRunPlanCancel";
import type { useRunPlanViewMode } from "./useRunPlanViewMode";
import { useRunRowHandlers } from "./useRunRowHandlers";

export type RunPlanRunResultsProps = {
  plan: RunPlan;
  batches: RunPlanBatches;
  selection: RunPlanSelection;
  cancel: ReturnType<typeof useRunPlanCancel>;
  viewMode: ReturnType<typeof useRunPlanViewMode>["viewMode"];
  periodControls: Pick<PeriodControls, "period" | "setRelativePeriod">;
  /** Runs one test case again, from its result row. */
  onRerunCase?: (scenarioRun: ScenarioRunData) => void;
};

type SelectedRunResultsProps = Pick<
  RunPlanRunResultsProps,
  "plan" | "selection" | "cancel" | "viewMode" | "onRerunCase"
> & { batch: BatchRun };

/** The run that is on screen, once there is one to read. */
function SelectedRunResults({
  plan,
  batch,
  selection,
  cancel,
  viewMode,
  onRerunCase,
}: SelectedRunResultsProps) {
  const { can } = useCan();
  const rows = useRunRowHandlers({ scenarioSetId: plan.scenarioSetId });
  const onCancelRun = cancel.canStop ? cancel.handleCancelRun : undefined;

  return (
    <>
      {viewMode === "grid" ? (
        <ScenarioRunContent
          scenarioRuns={batch.scenarioRuns}
          viewMode="grid"
          gridPadding={0}
          resolveTargetName={rows.resolveTargetName}
          onScenarioRunClick={rows.handleScenarioRunClick}
          iterationMap={selection.iterationMap}
          onCancelRun={onCancelRun}
          cancellingJobId={cancel.cancellingJobId}
        />
      ) : (
        <RunResultsTable
          scenarioRuns={batch.scenarioRuns}
          resolveTargetName={rows.resolveTargetName}
          iterationMap={selection.iterationMap}
          onScenarioRunClick={rows.handleScenarioRunClick}
          onCancelRun={onCancelRun}
          cancellingJobId={cancel.cancellingJobId}
          onEditCase={can("scenarios:manage") ? rows.handleEditCase : undefined}
          onRerunCase={onRerunCase}
        />
      )}
    </>
  );
}

export function RunPlanRunResults({
  plan,
  batches,
  selection,
  cancel,
  viewMode,
  periodControls,
  onRerunCase,
}: RunPlanRunResultsProps) {
  if (batches.error) {
    return (
      <RunsLoadError
        error={batches.error}
        onRetry={() => void batches.refetch()}
      />
    );
  }

  if (batches.isLoading) return <RunsLoadingSkeleton />;

  if (!selection.selectedBatch) {
    return (
      <NoRunInPeriod
        period={periodControls.period}
        setRelativePeriod={periodControls.setRelativePeriod}
      />
    );
  }

  return (
    <SelectedRunResults
      plan={plan}
      batch={selection.selectedBatch}
      selection={selection}
      cancel={cancel}
      viewMode={viewMode}
      onRerunCase={onRerunCase}
    />
  );
}
