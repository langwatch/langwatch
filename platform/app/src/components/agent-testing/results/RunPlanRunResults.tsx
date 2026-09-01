/**
 * The results of the selected run: a table by default, or the classic wall of
 * live conversation cards. Which run this is reads in the header line above,
 * so the results start straight away.
 *
 * A run against more than one target is a comparison, and reads as one: the
 * charts that put the targets next to each other, then the matrix with one
 * column per target. The grid reads one section per target, each under the
 * dot and the name of its target.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { VStack } from "@chakra-ui/react";
import {
  type BatchRun,
  targetKeyOfRun,
} from "~/components/suites/run-history-transforms";
import { ScenarioRunContent } from "~/components/suites/ScenarioRunContent";
import { useCan } from "~/hooks/useCan";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { TargetLegend } from "../shared/TargetDot";
import { ComparisonChartsBlock } from "./ComparisonChartsBlock";
import { ComparisonResultsTable } from "./ComparisonResultsTable";
import type { PeriodControls } from "./period-controls";
import {
  NoRunInPeriod,
  RunsLoadError,
  RunsLoadingSkeleton,
} from "./RunPlanResultsStates";
import { RunResultsTable } from "./RunResultsTable";
import type { RunPlan } from "./run-plans";
import {
  type BatchTarget,
  isComparison,
  runsOfTarget,
} from "./useBatchTargets";
import type { RunPlanBatches, RunPlanSelection } from "./useRunPlanBatches";
import type { useRunPlanCancel } from "./useRunPlanCancel";
import type { useRunPlanViewMode } from "./useRunPlanViewMode";
import { useRunRowHandlers } from "./useRunRowHandlers";

export type RunPlanRunResultsProps = {
  plan: RunPlan;
  batches: RunPlanBatches;
  selection: RunPlanSelection;
  /** The targets of the selected run, in order and in colour. */
  targets: BatchTarget[];
  cancel: ReturnType<typeof useRunPlanCancel>;
  viewMode: ReturnType<typeof useRunPlanViewMode>["viewMode"];
  periodControls: Pick<PeriodControls, "period" | "setRelativePeriod">;
  /** Runs one scenario again, from its result row. */
  onRerunCase?: (scenarioRun: ScenarioRunData) => void;
};

type SelectedRunResultsProps = Pick<
  RunPlanRunResultsProps,
  | "plan"
  | "batches"
  | "selection"
  | "targets"
  | "cancel"
  | "viewMode"
  | "onRerunCase"
> & { batch: BatchRun };

/** The grid of a comparison: one section per target, under its legend. */
function ComparisonGrid({
  batch,
  targets,
  resolveTargetName,
  onScenarioRunClick,
  iterationMap,
  onCancelRun,
  cancellingJobId,
}: {
  batch: BatchRun;
  targets: BatchTarget[];
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  iterationMap: Map<string, number>;
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
}) {
  return (
    <>
      {targets.map((target) => (
        <VStack
          key={target.key}
          align="stretch"
          gap={2}
          data-testid={`comparison-grid-${target.key}`}
        >
          <TargetLegend
            color={target.color}
            label={target.label}
            testId={`comparison-grid-legend-${target.key}`}
          />
          <ScenarioRunContent
            scenarioRuns={runsOfTarget({
              scenarioRuns: batch.scenarioRuns,
              target,
            })}
            viewMode="grid"
            gridPadding={0}
            resolveTargetName={resolveTargetName}
            onScenarioRunClick={onScenarioRunClick}
            iterationMap={iterationMap}
            onCancelRun={onCancelRun}
            cancellingJobId={cancellingJobId}
          />
        </VStack>
      ))}
    </>
  );
}

/**
 * How a card or a row names its target.
 *
 * On a comparison a target reads under the label its column carries, so the
 * same agent on two sets of parameters is told apart on a card too. A run of
 * a target the list does not hold falls back to the name the project holds.
 */
function targetNameResolver({
  targets,
  fallback,
}: {
  targets: BatchTarget[];
  fallback: (scenarioRun: ScenarioRunData) => string | null;
}): (scenarioRun: ScenarioRunData) => string | null {
  if (!isComparison(targets)) return fallback;
  return (scenarioRun) => {
    const key = targetKeyOfRun(scenarioRun);
    return (
      targets.find((target) => target.key === key)?.label ??
      fallback(scenarioRun)
    );
  };
}

/** The run that is on screen, once there is one to read. */
function SelectedRunResults({
  plan,
  batch,
  batches,
  selection,
  targets,
  cancel,
  viewMode,
  onRerunCase,
}: SelectedRunResultsProps) {
  const { can } = useCan();
  const rows = useRunRowHandlers({ scenarioSetId: plan.scenarioSetId });
  const onCancelRun = cancel.canStop ? cancel.handleCancelRun : undefined;
  const comparing = isComparison(targets);
  const resolveTargetName = targetNameResolver({
    targets,
    fallback: rows.resolveTargetName,
  });

  return (
    <>
      {comparing ? (
        <ComparisonChartsBlock
          targets={targets}
          batch={batch}
          batchRuns={batches.batchRuns}
          totalBatchCount={batches.totalBatchCount}
        />
      ) : null}

      {viewMode === "grid" ? (
        comparing ? (
          <ComparisonGrid
            batch={batch}
            targets={targets}
            resolveTargetName={resolveTargetName}
            onScenarioRunClick={rows.handleScenarioRunClick}
            iterationMap={selection.iterationMap}
            onCancelRun={onCancelRun}
            cancellingJobId={cancel.cancellingJobId}
          />
        ) : (
          <ScenarioRunContent
            scenarioRuns={batch.scenarioRuns}
            viewMode="grid"
            gridPadding={0}
            resolveTargetName={resolveTargetName}
            onScenarioRunClick={rows.handleScenarioRunClick}
            iterationMap={selection.iterationMap}
            onCancelRun={onCancelRun}
            cancellingJobId={cancel.cancellingJobId}
          />
        )
      ) : comparing ? (
        <ComparisonResultsTable
          scenarioRuns={batch.scenarioRuns}
          targets={targets}
          onScenarioRunClick={rows.handleScenarioRunClick}
          onCancelRun={onCancelRun}
          cancellingJobId={cancel.cancellingJobId}
        />
      ) : (
        <RunResultsTable
          scenarioRuns={batch.scenarioRuns}
          resolveTargetName={resolveTargetName}
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
  targets,
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
      batches={batches}
      selection={selection}
      targets={targets}
      cancel={cancel}
      viewMode={viewMode}
      onRerunCase={onRerunCase}
    />
  );
}
