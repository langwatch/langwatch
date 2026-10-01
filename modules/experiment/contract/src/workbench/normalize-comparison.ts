import { resolveExperimentVerdictLabel } from "../experiment-comparison.ts";
import {
  COMPARISON_EVALUATOR_TYPE,
  type ComparisonEvaluatorConfig,
  isComparisonEvaluatorType,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  type PairwiseEvaluatorConfig,
  type TargetConfig,
} from "../experiment-workbench.ts";

export { resolveExperimentVerdictLabel as resolveVerdictLabel };

// Reroutes legacy pairwise_compare to select_best_compare. Co-located type
// reroute and payload translation prevent #5528-style mismatches.
export const resolveDispatchEvaluatorType = (storedEvaluatorType: string): string =>
  storedEvaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE
    ? COMPARISON_EVALUATOR_TYPE
    : storedEvaluatorType;

// Single reader of legacy pairwise shape: everything downstream sees
// comparison only. Keep this as the one access or both shapes diverge.

type ComparisonCarrier = {
  pairwise?: PairwiseEvaluatorConfig;
  comparison?: ComparisonEvaluatorConfig;
};

/** A carrier that also names the evaluator type deciding what it may carry. */
type EvaluatorCarrier = ComparisonCarrier & { evaluatorType?: string };

// Fold legacy pairwise into comparison shape. variantA/B become variants[0/1]
// in order (labels resolve by position). Output paths collapse to per-variant
// map. Default randomizeOrder on for position bias mitigation.
const fromPairwise = (pairwise: PairwiseEvaluatorConfig): ComparisonEvaluatorConfig => {
  const variants = [pairwise.variantA, pairwise.variantB];

  const variantOutputPaths: Record<string, string[]> = {};
  if (pairwise.variantA && pairwise.variantAOutputPath?.length) {
    variantOutputPaths[pairwise.variantA] = pairwise.variantAOutputPath;
  }
  if (pairwise.variantB && pairwise.variantBOutputPath?.length) {
    variantOutputPaths[pairwise.variantB] = pairwise.variantBOutputPath;
  }

  return {
    variants,
    ...(Object.keys(variantOutputPaths).length > 0 && { variantOutputPaths }),
    hasGoldenAnswer: pairwise.hasGoldenAnswer ?? true,
    goldenField: pairwise.goldenField,
    includeMetrics: pairwise.includeMetrics ?? [],
    randomizeOrder: true,
  };
};

/**
 * The comparison config for an evaluator or a column-target, whichever shape it
 * was saved in. Returns undefined when the carrier is not a comparison at all.
 */
export const toComparisonConfig = (
  carrier: ComparisonCarrier,
): ComparisonEvaluatorConfig | undefined => {
  if (carrier.comparison) return carrier.comparison;
  if (carrier.pairwise) return fromPairwise(carrier.pairwise);
  return undefined;
};

/**
 * Rewrite a carrier so it holds only the canonical shape. Applied once at load,
 * so the rest of the app — and everything it saves back — never sees `pairwise`.
 */
const normalizeCarrier = <T extends ComparisonCarrier>(carrier: T): T => {
  const comparison = toComparisonConfig(carrier);
  if (!comparison) return carrier;
  const { pairwise: _legacy, ...rest } = carrier;
  return { ...rest, comparison } as T;
};

// Drop comparison config from evaluators that can't own a standalone
// comparison column. Only the comparison judge can; others render wrong.
const stripInvalidComparison = <T extends EvaluatorCarrier>(evaluator: T): T => {
  if (!evaluator.comparison) return evaluator;
  if (isComparisonEvaluatorType(evaluator.evaluatorType)) return evaluator;

  const { comparison: _invalid, ...attached } = evaluator;
  return attached as T;
};

/**
 * Generic over the evaluator shape so the browser store (narrowed
 * `EvaluatorConfig`) and the server read path (persisted shape, plain-string
 * `evaluatorType`) run the same function rather than two copies that drift.
 */
export const normalizeEvaluators = <T extends EvaluatorCarrier>(evaluators: T[]): T[] =>
  evaluators.map((evaluator) => stripInvalidComparison(normalizeCarrier(evaluator)));

// Drop comparison from non-evaluator targets. Only evaluator targets can own
// a comparison column; prompt/agent targets can't.
const stripNonEvaluatorComparison = (target: TargetConfig): TargetConfig => {
  if (!target.comparison) return target;
  if (target.type === "evaluator") return target;

  const { comparison: _invalid, ...rest } = target;
  return rest as TargetConfig;
};

export const normalizeTargets = (targets: TargetConfig[]): TargetConfig[] =>
  targets.map((target) => stripNonEvaluatorComparison(normalizeCarrier(target)));

// Single interpretation of verdict labels: check target.id, then promptId,
// then resolvedName. promptId check is for compatibility with older
// orchestrator versions.
export const labelNamesVariant = ({
  label,
  target,
  resolvedName,
}: {
  label: string;
  target: Pick<TargetConfig, "id"> & { promptId?: string };
  resolvedName?: string;
}): boolean =>
  label === target.id || label === target.promptId || (!!resolvedName && label === resolvedName);
