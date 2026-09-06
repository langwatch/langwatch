/** Phase 2: comparison cells (chip evaluators + column-style comparison targets), plus a typed skip reason for every row/comparison it could not build. */

import {
  COMPARISON_EVALUATOR_TYPE,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  toComparisonConfig,
  type ComparisonEvaluatorConfig,
  type EvaluationsV3State,
  type EvaluatorConfig,
  type ExecutionCell,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import {
  buildVariantDisplayNames,
  buildVariantIdentifiers,
} from "../processes/experiment-comparison-candidates.process.ts";
import { type ComparisonSkipReason } from "../processes/experiment-comparison-skip.process.ts";
import type { LoadedEvaluators } from "./experiment-execution-data.service.ts";
import { ExperimentComparisonVariantService } from "./experiment-comparison-variant.service.ts";

const logger = createLogger("langwatch:experiment:run-orchestrator");

/** One variant's already-computed evaluator scores, folded into a comparison's candidate text. */
export type VariantEvaluatorScore = {
  name: string;
  score?: number;
  label?: string;
  passed?: boolean;
};

export class ExperimentComparisonPlanService {
  static create({
    loadedPrompts,
    loadedEvaluators,
  }: {
    loadedPrompts?: Map<string, VersionedPrompt>;
    loadedEvaluators?: LoadedEvaluators;
  }): ExperimentComparisonPlanService {
    return new ExperimentComparisonPlanService(
      loadedPrompts,
      loadedEvaluators,
      ExperimentComparisonVariantService.create({ loadedEvaluators }),
    );
  }

  private constructor(
    private readonly loadedPrompts: Map<string, VersionedPrompt> | undefined,
    private readonly loadedEvaluators: LoadedEvaluators | undefined,
    private readonly variants: ExperimentComparisonVariantService,
  ) {}

  /** Chip-style comparison evaluators, verdict anchored on the first variant's column. */
  private planChipComparisons({
    state,
    datasetRows,
    rowsInScope,
    datasetId,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    cells,
    skipReasons,
  }: {
    state: Pick<EvaluationsV3State, "targets" | "evaluators">;
    datasetRows: Array<Record<string, unknown>>;
    rowsInScope: number[];
    datasetId: string;
    completedTargetOutputs: Map<string, { output: unknown; cost?: number; duration?: number }>;
    completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
    cells: ExecutionCell[];
    skipReasons: ComparisonSkipReason[];
  }): void {
    for (const evaluator of state.evaluators) {
      const cfg = toComparisonConfig(evaluator);
      if (!cfg) {
        continue;
      }

      const resolution = this.variants.resolveVariants({ state, cfg, ownerId: evaluator.id });
      if (resolution.skip) {
        const anchorId = this.variants.tryAnchorVariantId({ state, cfg });
        if (anchorId) {
          this.variants.pushSetupSkips({
            kind: resolution.skip,
            targetId: anchorId,
            evaluatorId: evaluator.id,
            rowsInScope,
            datasetRows,
            skipReasons,
          });
        }

        continue;
      }

      const resolvedVariants = resolution.variants;

      const variantIds = buildVariantIdentifiers({
        resolvedVariants,
        loadedPrompts: this.loadedPrompts,
      });
      const variantDisplayNames = buildVariantDisplayNames({
        resolvedVariants,
        loadedPrompts: this.loadedPrompts,
        loadedEvaluators: this.loadedEvaluators,
      });
      const anchorVariant = resolvedVariants[0]!;

      for (const rowIndex of rowsInScope) {
        const datasetEntry = datasetRows[rowIndex];
        if (!datasetEntry) {
          continue;
        }

        const built = this.variants.buildCandidates({
          cfg,
          variantIds,
          variantDisplayNames,
          rowIndex,
          completedTargetOutputs,
          completedTargetEvaluatorScores,
        });
        if (built.missing || built.empty) {
          skipReasons.push({
            rowIndex,
            targetId: anchorVariant.id,
            evaluatorId: evaluator.id,
            kind: built.missing ? "missing-output" : "empty-output",
            variantNames: built.missing ?? built.empty,
          });
          continue;
        }

        cells.push({
          rowIndex,
          targetId: anchorVariant.id,
          targetConfig: anchorVariant,
          evaluatorConfigs: [evaluator],
          datasetEntry: { _datasetId: datasetId, ...datasetEntry },
          skipTarget: true,
          precomputedTargetOutput: built.candidates!.candidates[0]!.output,
          comparison: built.candidates,
        });
      }
    }
  }

  /** The synthetic per-row evaluator a column-style comparison target dispatches through. */
  private syntheticColumnEvaluator({
    target,
    cfg,
    datasetId,
    datasetEntry,
    rowIndex,
    variantIds,
    legacyPairwise,
    built,
  }: {
    target: TargetConfig;
    cfg: ComparisonEvaluatorConfig;
    datasetId: string;
    datasetEntry: Record<string, unknown>;
    rowIndex: number;
    variantIds: string[];
    legacyPairwise: boolean;
    built: { candidates: ExecutionCell["comparison"] };
  }): EvaluatorConfig {
    const resolvedInput = // falls back to the golden field (#5100/#5378)
      (cfg.inputField ? datasetEntry[cfg.inputField] : undefined) ??
      datasetEntry.input ??
      (cfg.goldenField ? datasetEntry[cfg.goldenField] : undefined);
    if (resolvedInput === undefined && !cfg.hasGoldenAnswer && rowIndex === 0) {
      logger.debug(
        { targetId: target.id },
        "Comparison column-target: no 'input' dataset column and no golden field to " +
          "fall back on (has_golden_answer is off) — judge prompt will render an empty task/input",
      );
    }

    const goldenValue = // same #5378 gate buildEvaluatorInputs applies at runtime
      cfg.hasGoldenAnswer !== false && cfg.goldenField ? datasetEntry[cfg.goldenField] : undefined;

    // Per-row synthetic evaluator with pre-resolved value mappings (#5131).
    const [candidateA, candidateB] = built.candidates!.candidates;
    const perRowMappings: Record<
      string,
      Record<string, Record<string, { type: "value"; value: unknown }>>
    > = {
      [datasetId]: {
        [target.id]: legacyPairwise
          ? {
              candidate_a_id: { type: "value", value: variantIds[0] },
              candidate_a_output: { type: "value", value: candidateA?.output },
              candidate_a_cost: { type: "value", value: candidateA?.cost },
              candidate_a_duration: { type: "value", value: candidateA?.duration },
              candidate_b_id: { type: "value", value: variantIds[1] },
              candidate_b_output: { type: "value", value: candidateB?.output },
              candidate_b_cost: { type: "value", value: candidateB?.cost },
              candidate_b_duration: { type: "value", value: candidateB?.duration },
              input: { type: "value", value: resolvedInput },
              golden: { type: "value", value: goldenValue },
            }
          : {
              candidates: { type: "value", value: built.candidates!.candidates },
              row_index: { type: "value", value: rowIndex },
              input: { type: "value", value: resolvedInput },
              golden: { type: "value", value: goldenValue },
            },
      },
    };

    return {
      id: target.id,
      dbEvaluatorId: target.targetEvaluatorId,
      // Mirrors the judge that will actually run; see isLegacyPairwiseBacked (#5528).
      evaluatorType: legacyPairwise ? LEGACY_PAIRWISE_EVALUATOR_TYPE : COMPARISON_EVALUATOR_TYPE,
      comparison: cfg,
      inputs: target.inputs,
      mappings: perRowMappings,
    } as unknown as EvaluatorConfig;
  }

  /** Column-style comparison targets: each is its own column, verdict stored under its own id. */
  private planColumnComparisons({
    state,
    datasetRows,
    rowsInScope,
    datasetId,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    cells,
    skipReasons,
  }: {
    state: Pick<EvaluationsV3State, "targets">;
    datasetRows: Array<Record<string, unknown>>;
    rowsInScope: number[];
    datasetId: string;
    completedTargetOutputs: Map<string, { output: unknown; cost?: number; duration?: number }>;
    completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
    cells: ExecutionCell[];
    skipReasons: ComparisonSkipReason[];
  }): void {
    for (const target of state.targets) {
      if (target.type !== "evaluator") {
        continue;
      }

      const cfg = toComparisonConfig(target);
      if (!cfg || !target.targetEvaluatorId) {
        continue;
      }

      const resolution = this.variants.resolveVariants({ state, cfg, ownerId: target.id });
      if (resolution.skip) {
        this.variants.pushSetupSkips({
          kind: resolution.skip,
          targetId: target.id,
          evaluatorId: target.id,
          rowsInScope,
          datasetRows,
          skipReasons,
        });
        continue;
      }

      const resolvedVariants = resolution.variants;

      const variantIds = buildVariantIdentifiers({
        resolvedVariants,
        loadedPrompts: this.loadedPrompts,
      });
      const variantDisplayNames = buildVariantDisplayNames({
        resolvedVariants,
        loadedPrompts: this.loadedPrompts,
        loadedEvaluators: this.loadedEvaluators,
      });

      const legacyPairwise =
        this.variants.isLegacyPairwiseBacked(target.targetEvaluatorId) && variantIds.length === 2;

      for (const rowIndex of rowsInScope) {
        this.planColumnRow({
          target,
          cfg,
          rowIndex,
          datasetRows,
          datasetId,
          variantIds,
          variantDisplayNames,
          legacyPairwise,
          completedTargetOutputs,
          completedTargetEvaluatorScores,
          cells,
          skipReasons,
        });
      }
    }
  }

  /** One row of one column-style comparison target: its cell, or the reason it was skipped. */
  private planColumnRow({
    target,
    cfg,
    rowIndex,
    datasetRows,
    datasetId,
    variantIds,
    variantDisplayNames,
    legacyPairwise,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    cells,
    skipReasons,
  }: {
    target: TargetConfig;
    cfg: ComparisonEvaluatorConfig;
    rowIndex: number;
    datasetRows: Array<Record<string, unknown>>;
    datasetId: string;
    variantIds: string[];
    variantDisplayNames: string[];
    legacyPairwise: boolean;
    completedTargetOutputs: Map<string, { output: unknown; cost?: number; duration?: number }>;
    completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
    cells: ExecutionCell[];
    skipReasons: ComparisonSkipReason[];
  }): void {
    const datasetEntry = datasetRows[rowIndex];
    if (!datasetEntry) {
      return;
    }

    const built = this.variants.buildCandidates({
      cfg,
      variantIds,
      variantDisplayNames,
      rowIndex,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
    });
    if (built.missing || built.empty) {
      skipReasons.push({
        rowIndex,
        targetId: target.id,
        evaluatorId: target.id,
        kind: built.missing ? "missing-output" : "empty-output",
        variantNames: built.missing ?? built.empty,
      });

      return;
    }

    const syntheticEvaluator = this.syntheticColumnEvaluator({
      target,
      cfg,
      datasetId,
      datasetEntry,
      rowIndex,
      variantIds,
      legacyPairwise,
      built: built as { candidates: ExecutionCell["comparison"] },
    });

    cells.push({
      rowIndex,
      targetId: target.id,
      targetConfig: target,
      evaluatorConfigs: [syntheticEvaluator],
      datasetEntry: { _datasetId: datasetId, ...datasetEntry },
      skipTarget: true,
      precomputedTargetOutput: built.candidates!.candidates[0]!.output,
      comparison: built.candidates,
    });
  }

  generateComparisonCells({
    state,
    datasetRows,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    scopedRowIndices,
  }: {
    state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
    datasetRows: Array<Record<string, unknown>>;
    completedTargetOutputs: Map<string, { output: unknown; cost?: number; duration?: number }>;
    completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
    /** Rows this run is scoped to; omit to mean every row. Required, not defaulted. */
    scopedRowIndices: number[] | undefined;
  }): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } {
    const cells: ExecutionCell[] = [];
    const skipReasons: ComparisonSkipReason[] = [];
    const datasetId = this.resolveMappingDatasetId(state);
    const rowsInScope = scopedRowIndices ?? datasetRows.map((_, rowIndex) => rowIndex);

    this.planChipComparisons({
      state,
      datasetRows,
      rowsInScope,
      datasetId,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
      cells,
      skipReasons,
    });

    this.planColumnComparisons({
      state,
      datasetRows,
      rowsInScope,
      datasetId,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
      cells,
      skipReasons,
    });

    return { cells, skipReasons };
  }

  /** The dataset id a run reads mapping buckets from: the ACTIVE dataset, not `datasets[0]`. */
  private resolveMappingDatasetId(
    state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId">,
  ): string {
    const activeId = state.activeDatasetId;
    if (activeId && state.datasets.some((d) => d.id === activeId)) {
      return activeId;
    }

    return state.datasets[0]?.id ?? activeId ?? "dataset-1";
  }
}
