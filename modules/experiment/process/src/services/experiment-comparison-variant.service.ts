/**
 * The variant half of a comparison: which configured targets it actually compares, whether its
 * setup is complete enough to run at all, and the candidate text each row contributes. Shared by
 * the chip and column planners so a comparison means the same thing on both surfaces.
 */

import {
  COMPARISON_EVALUATOR_TYPE,
  type CellEvaluatorConfig,
  isGoldenFieldSatisfied,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  type ComparisonEvaluatorConfig,
  type EvaluationsV3State,
  type ExecutionCell,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";

import {
  evaluatorScoresBlock,
  pickOutputPath,
  toCandidateText,
} from "../eventing/experiment-comparison-candidates.process.ts";
import { type ComparisonSetupSkip } from "../eventing/experiment-comparison-skip.process.ts";
import type { VariantEvaluatorScore } from "./experiment-comparison-plan.service.ts";
import type { LoadedEvaluators } from "./experiment-execution-data.service.ts";

const logger = createLogger("langwatch:experiment:comparison-variants");
const runOrchestratorLogger = createLogger("langwatch:experiment:run-orchestrator");

export class ExperimentComparisonVariantService {
  private constructor(private readonly loadedEvaluators: LoadedEvaluators | undefined) {}

  static create({
    loadedEvaluators,
  }: {
    loadedEvaluators?: LoadedEvaluators;
  }): ExperimentComparisonVariantService {
    return new ExperimentComparisonVariantService(loadedEvaluators);
  }

  /** Resolve configured variant ids to TargetConfigs, or the setup skip reason (#5378). */
  resolveVariants({
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
  findAnchorVariantId({
    state,
    cfg,
  }: {
    state: Pick<EvaluationsV3State, "targets">;
    cfg: ComparisonEvaluatorConfig;
  }): string | undefined {
    return (cfg.variants ?? []).find((id) => state.targets.some((t) => t.id === id));
  }

  /** True if column-target uses legacy pairwise_compare judge. */
  isLegacyPairwiseBacked(dbEvaluatorId: string | undefined): boolean {
    if (!dbEvaluatorId) {
      return false;
    }

    const dbConfig = this.loadedEvaluators?.get(dbEvaluatorId)?.config as
      | { evaluatorType?: string }
      | undefined;

    return dbConfig?.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
  }

  /** The candidate payload for one row, or the names of variants with no output. */
  buildCandidates({
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

  /** The synthetic per-row evaluator a column-style comparison target dispatches through. */
  syntheticColumnEvaluator({
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
  }): CellEvaluatorConfig {
    const resolvedInput = // falls back to the golden field (#5100/#5378)
      (cfg.inputField ? datasetEntry[cfg.inputField] : undefined) ??
      datasetEntry.input ??
      (cfg.goldenField ? datasetEntry[cfg.goldenField] : undefined);
    if (resolvedInput === undefined && !cfg.hasGoldenAnswer && rowIndex === 0) {
      runOrchestratorLogger.debug(
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
    };
  }
}
