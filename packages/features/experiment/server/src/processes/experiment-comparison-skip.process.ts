/**
 * The five reasons a comparison row cannot be built, and the sentence a
 * customer reads for each. Pure. The copy lives here rather than on the
 * service so a test can pin the wording and the `error_type` without
 * running an orchestration.
 */

export type ComparisonSkipReason = {
  rowIndex: number;
  /** TargetId under which the verdict would have been stored. */
  targetId: string;
  /** The evaluator (or column-target) id whose cell would have run. */
  evaluatorId: string;
  /**
   * Why the row was skipped. "missing-output"/"empty-output" are data
   * problems fixed by re-running the target; the rest are setup problems
   * — no cell can be built for ANY row until the comparison is finished.
   */
  kind:
    | "missing-output"
    | "empty-output"
    | "too-few-variants"
    | "golden-not-set"
    | "variant-not-found";
  /** Display-friendly identifiers of the variants that triggered the skip. */
  variantNames: string[];
};

/** Why one comparison could not be resolved into cells at all. */
export type ComparisonSetupSkip = Extract<
  ComparisonSkipReason["kind"],
  "too-few-variants" | "golden-not-set" | "variant-not-found"
>;

/** "a", "a and b", "a, b and c" — for the skip-reason message. */
export const formatList = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/**
 * The row-level error copy for a skipped comparison. Exported so the
 * wording and `error_type` are pinned by tests without a whole
 * orchestration.
 */
export const comparisonSkipMessage = (
  reason: Pick<ComparisonSkipReason, "kind" | "variantNames">,
): { detail: string; errorType: string } => {
  const which = formatList(reason.variantNames);
  switch (reason.kind) {
    case "missing-output":
      return {
        detail: `Waiting on ${which}: no ${
          reason.variantNames.length > 1 ? "outputs" : "output"
        } for this row yet. Run ${which} first, then re-run this comparison.`,
        errorType: "MissingVariantOutput",
      };
    case "empty-output":
      // Re-running will not help: the output is empty or the picked field is
      // gone. Point the user at the output-field config.
      return {
        detail: `${which} produced no text to compare for this row. Check the output field selected for ${which}.`,
        errorType: "EmptyVariantOutput",
      };
    case "too-few-variants":
      return {
        detail:
          "This comparison needs at least 2 columns to compare. Pick the columns to compare in the evaluator settings, then run again.",
        errorType: "TooFewComparisonVariants",
      };
    case "golden-not-set":
      return {
        detail:
          "This comparison judges against a golden answer but no column is picked for it. Pick the golden field in the evaluator settings, then run again.",
        errorType: "GoldenFieldNotSet",
      };
    case "variant-not-found":
      return {
        detail:
          "A column this comparison compares no longer exists. Pick the columns to compare in the evaluator settings, then run again.",
        errorType: "ComparisonVariantNotFound",
      };
  }
};
