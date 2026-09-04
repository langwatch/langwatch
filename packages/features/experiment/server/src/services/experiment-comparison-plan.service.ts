/** Phase 2: comparison cells (chip evaluators + column-style comparison targets), plus a typed skip reason for every row/comparison it could not build. */

import {
  COMPARISON_EVALUATOR_TYPE,
  isGoldenFieldSatisfied,
  isRowEmpty,
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
  evaluatorScoresBlock,
  pickOutputPath,
  toCandidateText,
} from "../processes/experiment-comparison-candidates.process";
import {
  type ComparisonSetupSkip,
  type ComparisonSkipReason,
} from "../processes/experiment-comparison-skip.process";
import type { LoadedEvaluators } from "./experiment-execution-data.service";

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
    return new ExperimentComparisonPlanService(loadedPrompts, loadedEvaluators);
  }

  private constructor(
    private readonly loadedPrompts: Map<string, VersionedPrompt> | undefined,
    private readonly loadedEvaluators: LoadedEvaluators | undefined,
  ) {}

  /** Resolve configured variant ids to TargetConfigs, or the setup skip reason (#5378). */
  private resolveVariants({
    state,
    cfg,
    ownerId,
  }: {
    state: Pick<EvaluationsV3State, "targets">;
    cfg: ComparisonEvaluatorConfig;
    ownerId: string;
  }): { variants: TargetConfig[]; skip?: never } | { skip: ComparisonSetupSkip; variants?: never } {
    if (!cfg.variants || cfg.variants.length < 2) {
      logger.warn(
        { ownerId, variants: cfg.variants },
        "Comparison skipped: fewer than 2 variants configured",
      );

      return { skip: "too-few-variants" };
    }

    if (!isGoldenFieldSatisfied(cfg)) {
      logger.debug(
        {
          ownerId,
          variants: cfg.variants,
          hasGoldenAnswer: cfg.hasGoldenAnswer,
          goldenField: cfg.goldenField,
        },
        "Comparison skipped: golden field not configured",
      );

      return { skip: "golden-not-set" };
    }

    const resolved = cfg.variants.map((id) => state.targets.find((t) => t.id === id));
    if (resolved.some((t) => !t)) {
      logger.warn(
        { ownerId, variants: cfg.variants },
        "Comparison skipped: one or more variant targets not found",
      );

      return { skip: "variant-not-found" };
    }

    return { variants: resolved as TargetConfig[] };
  }

  /** The column a chip-style comparison's verdict hangs under: its first live variant. */
  private anchorVariantId({
    state,
    cfg,
  }: {
    state: Pick<EvaluationsV3State, "targets">;
    cfg: ComparisonEvaluatorConfig;
  }): string | undefined {
    return (cfg.variants ?? []).find((id) => state.targets.some((t) => t.id === id));
  }

  /** One error row per scoped row for a comparison that cannot be built. */
  private pushSetupSkips({
    kind,
    targetId,
    evaluatorId,
    rowsInScope,
    datasetRows,
    skipReasons,
  }: {
    kind: ComparisonSetupSkip;
    targetId: string;
    evaluatorId: string;
    rowsInScope: number[];
    datasetRows: Array<Record<string, unknown>>;
    skipReasons: ComparisonSkipReason[];
  }): void {
    for (const rowIndex of rowsInScope) {
      const datasetEntry = datasetRows[rowIndex];
      if (!datasetEntry || isRowEmpty(datasetEntry)) {
        continue;
      }

      skipReasons.push({ rowIndex, targetId, evaluatorId, kind, variantNames: [] });
    }
  }

  /** Whether a column-target's backing DB evaluator is still the legacy `pairwise_compare` judge. */
  private isLegacyPairwiseBacked(dbEvaluatorId: string | undefined): boolean {
    if (!dbEvaluatorId) {
      return false;
    }

    const dbConfig = this.loadedEvaluators?.get(dbEvaluatorId)?.config as
      | { evaluatorType?: string }
      | undefined;

    return dbConfig?.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
  }

  /** The candidate payload for one row, or the names of variants with no output. */
  private buildCandidates({
    cfg,
    variantIds,
    variantDisplayNames,
    rowIndex,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
  }: {
    cfg: ComparisonEvaluatorConfig;
    variantIds: string[];
    variantDisplayNames: string[];
    rowIndex: number;
    completedTargetOutputs: Map<string, { output: unknown; cost?: number; duration?: number }>;
    completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
  }):
    | { candidates: ExecutionCell["comparison"]; missing?: never; empty?: never }
    | { candidates?: never; missing: string[]; empty?: never }
    | { candidates?: never; missing?: never; empty: string[] } {
    const outputs = cfg.variants.map((id) => completedTargetOutputs.get(`${rowIndex}:${id}`));

    const missing = variantDisplayNames.filter((_, i) => !outputs[i]);
    if (missing.length > 0) {
      return { missing };
    }

    const candidates = cfg.variants.map((variantId, i) => {
      const text = toCandidateText(
        pickOutputPath(outputs[i]!.output, cfg.variantOutputPaths?.[variantId]),
      );

      return {
        id: variantIds[i]!,
        output: text
          ? text + evaluatorScoresBlock({ rowIndex, variantId, completedTargetEvaluatorScores })
          : text,
        cost: outputs[i]!.cost,
        duration: outputs[i]!.duration,
      };
    });

    const empty = variantDisplayNames.filter((_, i) => candidates[i]!.output === "");
    if (empty.length > 0) {
      return { empty };
    }

    return { candidates: { candidates } };
  }

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

      const resolution = this.resolveVariants({ state, cfg, ownerId: evaluator.id });
      if (resolution.skip) {
        const anchorId = this.anchorVariantId({ state, cfg });
        if (anchorId) {
          this.pushSetupSkips({
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

        const built = this.buildCandidates({
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

      const resolution = this.resolveVariants({ state, cfg, ownerId: target.id });
      if (resolution.skip) {
        this.pushSetupSkips({
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
        this.isLegacyPairwiseBacked(target.targetEvaluatorId) && variantIds.length === 2;

      for (const rowIndex of rowsInScope) {
        const datasetEntry = datasetRows[rowIndex];
        if (!datasetEntry) {
          continue;
        }

        const built = this.buildCandidates({
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
          continue;
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
    }
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
