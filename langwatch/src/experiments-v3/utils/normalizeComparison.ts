import type {
  ComparisonEvaluatorConfig,
  EvaluatorConfig,
  PairwiseEvaluatorConfig,
  TargetConfig,
} from "../types";

/**
 * Comparison configs are stored in one shape today (`comparison`), but
 * experiments saved before pairwise and N-way were merged carry a two-slot
 * `pairwise` shape instead. This is the ONE place that reads the legacy shape;
 * everything downstream sees `comparison` only, and nothing ever writes
 * `pairwise` again. That is the whole of the "read old, write new" contract.
 *
 * Keep this as the single reader. A second `.pairwise` access anywhere else is
 * how the two shapes start diverging again.
 */

type ComparisonCarrier = {
  pairwise?: PairwiseEvaluatorConfig;
  comparison?: ComparisonEvaluatorConfig;
};

/**
 * Fold a legacy pairwise config into the canonical comparison shape.
 *
 * `variantA`/`variantB` become the first two entries of `variants`, preserving
 * their order — the judge's legacy `"A"` / `"B"` slot labels are resolved
 * against those positions, so the order is load-bearing, not cosmetic.
 * The two per-slot output paths collapse into the per-variant map.
 *
 * Legacy pairwise had no `randomizeOrder` (it mitigated position bias with
 * swap-and-confirm, which the comparison judge does not have). Defaulting it on
 * gives a re-run of an old column the strongest mitigation still available.
 */
const fromPairwise = (
  pairwise: PairwiseEvaluatorConfig,
): ComparisonEvaluatorConfig => {
  const variants = [pairwise.variantA, pairwise.variantB].filter(
    (id): id is string => !!id,
  );

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

export const normalizeEvaluators = (
  evaluators: EvaluatorConfig[],
): EvaluatorConfig[] => evaluators.map(normalizeCarrier);

export const normalizeTargets = (targets: TargetConfig[]): TargetConfig[] =>
  targets.map(normalizeCarrier);

/**
 * Resolve a stored verdict label to the winning variant's target id.
 *
 * Runs before the merge stored slot letters (`"A"` / `"B"`); runs after store
 * the winning candidate's identifier directly. Both still live in the database,
 * so both must resolve. `"tie"` passes through untouched.
 */
export const resolveVerdictLabel = ({
  label,
  variants,
}: {
  label: string;
  variants: string[];
}): string => {
  if (label === "A") return variants[0] ?? label;
  if (label === "B") return variants[1] ?? label;
  return label;
};
