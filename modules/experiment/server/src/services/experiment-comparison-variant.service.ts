/**
 * The variant half of a comparison: which configured targets it actually compares, whether its
 * setup is complete enough to run at all, and the candidate text each row contributes. Shared by
 * the chip and column planners so a comparison means the same thing on both surfaces.
 */

import {
  isGoldenFieldSatisfied,
  isRowEmpty,
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
} from "../processes/experiment-comparison-candidates.process.ts";
import {
  type ComparisonSetupSkip,
  type ComparisonSkipReason,
} from "../processes/experiment-comparison-skip.process.ts";
import type { LoadedEvaluators } from "./experiment-execution-data.service.ts";
import type { VariantEvaluatorScore } from "./experiment-comparison-plan.service.ts";

const logger = createLogger("langwatch:experiment:comparison-variants");

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

  /** One error row per scoped row for a comparison that cannot be built. */
  pushSetupSkips({
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
}
