import { HandledError } from "@langwatch/handled-error";

/**
 * Handled errors raised while building a comparison target.
 *
 * Every one of these is a request the caller can fix by changing what they
 * sent: a variant that names a target the experiment does not have, a golden
 * field that is not a column, a pair of variants that turn out to be the same
 * target. They each carry a stable code so the CLI, the API and the UI branch
 * on the same value, and the identifying pieces ride in `meta` so a caller can
 * render the correction without parsing prose.
 *
 * Failures that are NOT knowable this way stay plain `Error`s and degrade to
 * "unknown" at the boundary with a trace id.
 */

/** A `target:<id>` variant naming a target that is not in this experiment. */
export class ComparisonVariantTargetNotFoundError extends HandledError {
  declare readonly code: "comparison_variant_target_not_found";

  constructor({
    targetId,
    availableTargets,
  }: {
    targetId: string;
    availableTargets: readonly { id: string; type: string }[];
  }) {
    const described =
      availableTargets.length > 0
        ? availableTargets.map((t) => `${t.id} (${t.type})`).join(", ")
        : "none";
    super(
      "comparison_variant_target_not_found",
      `Target "${targetId}" is not in this experiment. Current targets: ${described}`,
      {
        httpStatus: 400,
        meta: { targetId, availableTargets },
      },
    );
    this.name = "ComparisonVariantTargetNotFoundError";
  }
}

/** An `agent:<id>` variant naming an agent that does not exist in the project. */
export class ComparisonVariantAgentNotFoundError extends HandledError {
  declare readonly code: "comparison_variant_agent_not_found";

  constructor({
    agentId,
    reasons,
  }: {
    agentId: string;
    reasons?: readonly Error[];
  }) {
    super(
      "comparison_variant_agent_not_found",
      `Agent "${agentId}" not found`,
      { httpStatus: 404, meta: { agentId }, reasons },
    );
    this.name = "ComparisonVariantAgentNotFoundError";
  }
}

/**
 * A variant that is itself a comparison. A comparison judges between targets
 * that produce outputs, and a comparison's output is a verdict about other
 * targets, so nesting one inside another has no runnable meaning.
 */
export class ComparisonVariantIsComparisonError extends HandledError {
  declare readonly code: "comparison_variant_is_comparison";

  constructor(targetId: string) {
    super(
      "comparison_variant_is_comparison",
      `Target "${targetId}" is itself a comparison and cannot be a variant of another comparison`,
      { httpStatus: 400, meta: { targetId } },
    );
    this.name = "ComparisonVariantIsComparisonError";
  }
}

/**
 * A newly created variant target whose required inputs have no dataset column
 * to read from. Raised before anything is persisted: a comparison whose
 * variant can never produce an output is worse than a refused request.
 */
export class ComparisonVariantUnmappableError extends HandledError {
  declare readonly code: "comparison_variant_unmappable";

  constructor({
    variant,
    fields,
    datasetId,
  }: {
    variant: string;
    fields: readonly string[];
    datasetId: string;
  }) {
    super(
      "comparison_variant_unmappable",
      `No dataset column matches the required input(s) [${fields.join(", ")}] of the target built from ${variant}. Add a matching column to the dataset, or reference an existing target instead.`,
      { httpStatus: 400, meta: { variant, fields, datasetId } },
    );
    this.name = "ComparisonVariantUnmappableError";
  }
}

/**
 * Two or more variants that resolve to the same underlying target, leaving
 * fewer than two distinct candidates. The request passed the `min(2)` bound on
 * the wire, so this is only reachable after resolution: an explicit duplicate,
 * or a `prompt:`/`agent:` spec that reuses a target already named by `target:`.
 */
export class ComparisonVariantsNotDistinctError extends HandledError {
  declare readonly code: "comparison_variants_not_distinct";

  constructor(targetIds: readonly string[]) {
    super(
      "comparison_variants_not_distinct",
      "A comparison needs at least two different variants, and the ones given all resolved to the same target.",
      { httpStatus: 400, meta: { targetIds } },
    );
    this.name = "ComparisonVariantsNotDistinctError";
  }
}

/**
 * A `goldenField` or `inputField` that is not a column on the active dataset.
 * These are free text on the wire, unlike the workbench's dropdown, so a typo
 * would otherwise persist and only surface as a missing value at run time.
 */
export class ComparisonFieldNotInDatasetError extends HandledError {
  declare readonly code: "comparison_field_not_in_dataset";

  constructor({
    field,
    value,
    datasetId,
    availableColumns,
  }: {
    field: "goldenField" | "inputField";
    value: string;
    datasetId: string;
    availableColumns: readonly string[];
  }) {
    super(
      "comparison_field_not_in_dataset",
      `${field} "${value}" is not a column on dataset "${datasetId}". Available columns: ${availableColumns.join(", ") || "none"}`,
      {
        httpStatus: 400,
        meta: { field, value, datasetId, availableColumns },
      },
    );
    this.name = "ComparisonFieldNotInDatasetError";
  }
}

/** `hasGoldenAnswer` asked for, with no field naming where the answer lives. */
export class ComparisonGoldenFieldRequiredError extends HandledError {
  declare readonly code: "comparison_golden_field_required";

  constructor() {
    super(
      "comparison_golden_field_required",
      "A comparison judged against a reference answer needs a golden field naming the column that holds it.",
      { httpStatus: 400 },
    );
    this.name = "ComparisonGoldenFieldRequiredError";
  }
}
