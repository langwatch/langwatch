/**
 * The plan a run's `started` carries (ARCHITECTURE §9, D4 and D5): its snapshot, its scoped rows
 * once each, phase-1 cells from the cell planner, then the comparison cells the configuration asks
 * for, with their setup skips. Design: modules/experiment/specs/experiment-run-execution.md §2, §4.
 */
import {
  type EvaluationsV3State,
  type ExecutionCell,
  type ExecutionScope,
  type ExperimentRunComparisonCell,
  type ExperimentRunOrigin,
  type ExperimentRunPlan,
  experimentRunPlanSchema,
  type ExperimentRunTargetCell,
} from "@langwatch/experiment-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { RunActor } from "@langwatch/scenario-contract";

import { promptLoadKey, workflowLoadKey } from "../rules/experiment-execution-data.rules.ts";
import {
  ExperimentCellPlanService,
  type SeededTargetOutput,
} from "./experiment-cell-plan.service.ts";
import { ExperimentComparisonPlanService } from "./experiment-comparison-plan.service.ts";
import type { LoadedExecutionData, LoadedWorkflow } from "./experiment-execution-data.service.ts";

/** What a run was asked to do: the workbench configuration, its scope and any reused outputs. */
export type ExperimentRunPlanRequest = {
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
  scope: ExecutionScope;
  seedTargetOutputs?: Record<string, SeededTargetOutput>;
};

/** The loaded execution data a plan reads: its rows and the prompt and workflow versions to pin. */
export type ExperimentRunPlanData = Pick<LoadedExecutionData, "datasetRows" | "datasetColumns"> & {
  loadedPrompts: ReadonlyMap<string, Pick<VersionedPrompt, "id" | "version">>;
  loadedWorkflows: ReadonlyMap<string, Pick<LoadedWorkflow, "id" | "versionId">>;
};

export class ExperimentRunPlanService {
  private constructor(
    private readonly cellPlan: ExperimentCellPlanService,
    private readonly comparisonPlan: ExperimentComparisonPlanService,
  ) {}

  static create(): ExperimentRunPlanService {
    return new ExperimentRunPlanService(
      ExperimentCellPlanService.create(),
      ExperimentComparisonPlanService.create({}),
    );
  }

  /** The run's plan, parsed by the contract's schema so a cell reads back exactly this. */
  buildPlan({
    request,
    data,
    concurrency,
    origin,
    persistResults,
    actor,
  }: {
    request: ExperimentRunPlanRequest;
    data: ExperimentRunPlanData;
    concurrency: number;
    origin: ExperimentRunOrigin;
    persistResults: boolean;
    actor?: RunActor;
  }): ExperimentRunPlan {
    const { state, scope, seedTargetOutputs } = request;
    const targetCells = this.cellPlan
      .generateCells({ state, datasetRows: data.datasetRows, scope, seedTargetOutputs })
      .map((cell, ordinal) => targetCellOf({ cell, ordinal }));
    const comparisonCells = this.comparisonCells({
      request,
      datasetRows: data.datasetRows,
      firstOrdinal: targetCells.length,
    });
    const cells = [...targetCells, ...comparisonCells];

    return experimentRunPlanSchema.parse({
      concurrency,
      origin,
      persistResults,
      ...(actor ? { actor } : {}),
      scope,
      mappingDatasetId: this.cellPlan.resolveMappingDatasetId(state),
      targets: state.targets,
      evaluators: state.evaluators,
      datasetColumns: data.datasetColumns,
      rows: [...new Set(cells.map((cell) => cell.rowIndex))]
        .toSorted((a, b) => a - b)
        .flatMap((rowIndex) => {
          const entry = data.datasetRows[rowIndex];
          return entry ? [{ rowIndex, entry }] : [];
        }),
      cells,
      pinned: pinnedVersionsOf({ state, data }),
      ...(seedTargetOutputs ? { seedTargetOutputs } : {}),
    });
  }

  /** Phase 2 from the configuration alone; an evaluator re-run judges no comparison, as main's. */
  private comparisonCells({
    request,
    datasetRows,
    firstOrdinal,
  }: {
    request: ExperimentRunPlanRequest;
    datasetRows: Record<string, unknown>[];
    firstOrdinal: number;
  }): ExperimentRunComparisonCell[] {
    const { state, scope } = request;
    if (scope.type === "evaluator" || scope.type === "evaluator-all-rows") {
      return [];
    }

    const scopedRowIndices = this.cellPlan.resolveScopedRowIndices({
      scope,
      rowCount: datasetRows.length,
    });

    return this.comparisonPlan
      .buildComparisonSet({ state, datasetRows, scopedRowIndices })
      .flatMap((comparison) =>
        comparison.rowIndices.map((rowIndex) => ({
          rowIndex,
          targetId: comparison.targetId,
          evaluatorId: comparison.evaluatorId,
          ...(comparison.setupSkip
            ? { setupSkip: { kind: comparison.setupSkip, variantNames: [] } }
            : {}),
        })),
      )
      .map((cell, index) => ({ ordinal: firstOrdinal + index, phase: 2, ...cell }));
  }
}

/** A phase-1 cell as the plan keeps it: row, target and evaluator ids, and any reused output. */
function targetCellOf({
  cell,
  ordinal,
}: {
  cell: ExecutionCell;
  ordinal: number;
}): ExperimentRunTargetCell {
  return {
    ordinal,
    phase: 1,
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
    evaluatorIds: cell.evaluatorConfigs.map((evaluator) => evaluator.id),
    ...(cell.skipTarget !== undefined ? { skipTarget: cell.skipTarget } : {}),
    ...(cell.precomputedTargetOutput !== undefined
      ? { precomputedTargetOutput: cell.precomputedTargetOutput }
      : {}),
    ...(cell.traceId !== undefined ? { traceId: cell.traceId } : {}),
  };
}

/** Each prompt and workflow target at the version the run loaded, so every cell runs that one. */
function pinnedVersionsOf({
  state,
  data,
}: {
  state: ExperimentRunPlanRequest["state"];
  data: ExperimentRunPlanData;
}): ExperimentRunPlan["pinned"] {
  const pinned: ExperimentRunPlan["pinned"] = { prompts: [], workflows: [] };
  for (const target of state.targets) {
    if (target.type === "prompt" && target.promptId) {
      const prompt = data.loadedPrompts.get(promptLoadKey(target));
      if (prompt) {
        pinned.prompts.push({ targetId: target.id, promptId: prompt.id, version: prompt.version });
      }
    }

    if (target.type === "workflow" && target.workflowId) {
      const workflow = data.loadedWorkflows.get(workflowLoadKey(target));
      if (workflow) {
        pinned.workflows.push({
          targetId: target.id,
          workflowId: workflow.id,
          versionId: workflow.versionId,
        });
      }
    }
  }

  return pinned;
}
