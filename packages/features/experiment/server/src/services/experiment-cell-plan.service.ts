/**
 * Turns a workbench state plus a run scope into the concrete phase-1 cells
 * a run executes, and answers how many there will be before the run
 * starts. Reaches nothing outside itself: given the same state, rows and
 * scope it returns the same list, which is why the polling run can call it
 * to publish a total before any cell has run.
 */

import {
  comparisonDependencies,
  isComparisonEvaluator,
  isRowEmpty,
  toComparisonConfig,
  type EvaluationsV3State,
  type ExecutionCell,
  type ExecutionScope,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:experiment:run-orchestrator");

/** A precomputed target output a cell can seed instead of executing. */
export type SeededTargetOutput = { output: unknown; cost?: number; duration?: number };

type PlanState = Pick<
  EvaluationsV3State,
  "datasets" | "activeDatasetId" | "targets" | "evaluators"
>;

export class ExperimentCellPlanService {
  static create(): ExperimentCellPlanService {
    return new ExperimentCellPlanService();
  }

  private constructor() {}

  /**
   * The dataset rows a run may touch, given its scope (bugbash 2026-07-14).
   * `full`/`target`/`evaluator-all-rows` span the dataset; the rest are
   * pinned to the rows the user picked.
   */
  resolveScopedRowIndices({
    scope,
    rowCount,
  }: {
    scope: ExecutionScope;
    rowCount: number;
  }): number[] {
    const allRows = () => Array.from({ length: rowCount }, (_, i) => i);
    const inRange = (i: number) => i >= 0 && i < rowCount;
    // A row named twice is still one row. Kept as-sent otherwise, so the run
    // covers the rows in the order the caller asked for.
    const picked = (indices: number[]) => Array.from(new Set(indices.filter(inRange)));

    switch (scope.type) {
      case "full":
      case "target":
      case "evaluator-all-rows":
        return allRows();
      case "rows":
        return picked(scope.rowIndices);
      case "target-rows":
        return scope.rowIndices ? picked(scope.rowIndices) : allRows();
      case "cell":
      case "evaluator":
        return [scope.rowIndex].filter(inRange);
      default:
        return [];
    }
  }

  /**
   * The dataset id a run reads mapping buckets from: the ACTIVE dataset, not
   * `datasets[0]` — the wrong bucket runs every node with no inputs. Falls
   * back to the first dataset only when state names no active one.
   */
  private resolveMappingDatasetId(
    state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId">,
  ): string {
    const activeId = state.activeDatasetId;
    if (activeId && state.datasets.some((d) => d.id === activeId)) return activeId;
    return state.datasets[0]?.id ?? activeId ?? "dataset-1";
  }

  /** One evaluator re-run over every row it has a precomputed target output for. */
  private cellsForEvaluatorAllRowsScope({
    state,
    datasetRows,
    scope,
    datasetId,
  }: {
    state: PlanState;
    datasetRows: Array<Record<string, unknown>>;
    scope: Extract<ExecutionScope, { type: "evaluator-all-rows" }>;
    datasetId: string;
  }): ExecutionCell[] {
    const cells: ExecutionCell[] = [];
    const targetConfig = state.targets.find((t: TargetConfig) => t.id === scope.targetId);
    const evaluatorConfig = state.evaluators.find((e) => e.id === scope.evaluatorId);

    // A comparison evaluator needs every variant's output, not one target's,
    // so it is not attached here (see the comparison-skip block below) — it
    // would otherwise silently receive an empty input object.
    if (!targetConfig || !evaluatorConfig || isComparisonEvaluator(evaluatorConfig)) return cells;

    for (const [rowIndexStr, targetOutput] of Object.entries(scope.precomputedTargetOutputs)) {
      const rowIndex = Number(rowIndexStr);
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry) continue;

      cells.push({
        rowIndex,
        targetId: scope.targetId,
        targetConfig,
        evaluatorConfigs: [evaluatorConfig],
        datasetEntry: { _datasetId: datasetId, ...datasetEntry },
        skipTarget: true,
        precomputedTargetOutput: targetOutput,
        traceId: scope.traceIds[rowIndex],
      });
    }
    return cells;
  }

  /** One evaluator re-run against a single row's precomputed target output. */
  private cellsForEvaluatorScope({
    state,
    datasetRows,
    scope,
    datasetId,
  }: {
    state: PlanState;
    datasetRows: Array<Record<string, unknown>>;
    scope: Extract<ExecutionScope, { type: "evaluator" }>;
    datasetId: string;
  }): ExecutionCell[] {
    const cells: ExecutionCell[] = [];
    const targetConfig = state.targets.find((t: TargetConfig) => t.id === scope.targetId);
    const evaluatorConfig = state.evaluators.find((e) => e.id === scope.evaluatorId);
    const datasetEntry = datasetRows[scope.rowIndex];

    // See the matching guard in the evaluator-all-rows branch above — a
    // comparison evaluator can't run against one target's precomputed output.
    if (
      targetConfig &&
      evaluatorConfig &&
      !isComparisonEvaluator(evaluatorConfig) &&
      datasetEntry
    ) {
      cells.push({
        rowIndex: scope.rowIndex,
        targetId: scope.targetId,
        targetConfig,
        evaluatorConfigs: [evaluatorConfig],
        datasetEntry: { _datasetId: datasetId, ...datasetEntry },
        skipTarget: scope.targetOutput !== undefined,
        precomputedTargetOutput: scope.targetOutput,
        traceId: scope.traceId,
      });
    }
    return cells;
  }

  /**
   * Which targets a scope expands to once a comparison's dependencies are
   * pulled in, so a scoped run on a comparison never has fewer columns
   * than Phase 2 needs to judge.
   */
  private scopedTargetIds({ state, scope }: { state: PlanState; scope: ExecutionScope }): string[] {
    const expandComparisonDeps = (id: string): string[] => {
      const t = state.targets.find((tg: TargetConfig) => tg.id === id);
      if (t?.type !== "evaluator") return [id];
      const deps = (toComparisonConfig(t)?.variants ?? []).filter((v): v is string => !!v);
      if (deps.length === 0) return [id];
      return Array.from(new Set([...deps, id]));
    };

    switch (scope.type) {
      case "full":
      case "rows":
        return state.targets.map((t: TargetConfig) => t.id);
      case "target":
      case "cell":
        return expandComparisonDeps(scope.targetId);
      case "target-rows":
        return Array.from(new Set(scope.targetIds.flatMap(expandComparisonDeps)));
      default:
        return [];
    }
  }

  /** Generates all cells to execute based on the scope. */
  generateCells({
    state,
    datasetRows,
    scope,
    seedTargetOutputs,
  }: {
    state: PlanState;
    datasetRows: Array<Record<string, unknown>>;
    scope: ExecutionScope;
    seedTargetOutputs?: Record<string, SeededTargetOutput>;
  }): ExecutionCell[] {
    const datasetId = this.resolveMappingDatasetId(state);

    if (scope.type === "evaluator-all-rows") {
      return this.cellsForEvaluatorAllRowsScope({ state, datasetRows, scope, datasetId });
    }
    if (scope.type === "evaluator") {
      return this.cellsForEvaluatorScope({ state, datasetRows, scope, datasetId });
    }

    const cells: ExecutionCell[] = [];

    // Determine which rows to process. Shared with Phase 2's comparison cells so
    // the two phases can never disagree about what's in scope.
    const rowIndices = this.resolveScopedRowIndices({ scope, rowCount: datasetRows.length });

    const comparisonDeps = (id: string): string[] =>
      comparisonDependencies({
        targets: state.targets,
        evaluators: state.evaluators,
        targetId: id,
      });

    const targetIds = this.scopedTargetIds({ state, scope });

    const scopedComparisonDeps = new Set(
      (scope.type === "target" || scope.type === "cell"
        ? [scope.targetId]
        : scope.type === "target-rows"
          ? scope.targetIds
          : []
      ).flatMap(comparisonDeps),
    );

    for (const rowIndex of rowIndices) {
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry) continue;

      if (isRowEmpty(datasetEntry)) {
        logger.debug({ rowIndex }, "Skipping empty row");
        continue;
      }

      for (const targetId of targetIds) {
        if (scopedComparisonDeps.has(targetId) && seedTargetOutputs?.[`${rowIndex}:${targetId}`]) {
          continue;
        }

        const targetConfig = state.targets.find((t: TargetConfig) => t.id === targetId);
        if (!targetConfig) continue;

        // Column-style comparison targets (pairwise #5100, N-way #5101) are
        // skipped in Phase 1 — they need every variant's output, not yet
        // available per-target. Picked up by generateComparisonCells (Phase 2).
        if (targetConfig.type === "evaluator" && isComparisonEvaluator(targetConfig)) continue;

        cells.push({
          rowIndex,
          targetId,
          targetConfig,
          // Comparison evaluators (pairwise #5100, N-way #5101) run in Phase 2
          // once every variant's output exists; they would crash here. See
          // generateComparisonCells.
          evaluatorConfigs: state.evaluators.filter((e) => !isComparisonEvaluator(e)),
          datasetEntry: { _datasetId: datasetId, ...datasetEntry },
        });
      }
    }

    return cells;
  }

  /**
   * How many cells a scope will dispatch, before the run starts — the plan
   * itself (comparison deps included), not rows times targets. Phase 1
   * only; `runOrchestrator` adds the comparison count once known.
   */
  countScopedCells({
    state,
    datasetRows,
    scope,
    seedTargetOutputs,
  }: {
    state: PlanState;
    datasetRows: Array<Record<string, unknown>>;
    scope: ExecutionScope;
    seedTargetOutputs?: Record<string, SeededTargetOutput>;
  }): number {
    return this.generateCells({ state, datasetRows, scope, seedTargetOutputs }).length;
  }
}
