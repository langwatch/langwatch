import type { EvaluationRunData } from "@langwatch/evaluation-contract";

/** The legacy filter fields only answerable once a trace's evaluations have run. */
const EVALUATION_FIELDS: ReadonlySet<string> = new Set([
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.evaluator_id.has_label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
]);

/** The evaluation half of a trigger's legacy filters; trace answers the other half. */
export class EvaluationFilterMatchingService {
  static create(): EvaluationFilterMatchingService {
    return new EvaluationFilterMatchingService();
  }

  private constructor() {}

  /**
   * `string[]` matches by evaluator_id, keyed filters match a value per evaluator,
   * and double-keyed (`evaluations.score`) ignores the subkey since a run carries
   * one score; fields AND, and non-evaluation fields are left to the trace half.
   */
  matchesEvaluationFilters(input: {
    filters: Readonly<Record<string, unknown>>;
    evaluations: EvaluationRunData[];
  }): boolean {
    for (const [field, filterValue] of Object.entries(input.filters)) {
      if (!filterValue) {
        continue;
      }

      if (!EVALUATION_FIELDS.has(field)) {
        continue;
      }

      if (!matchEvaluationField(input.evaluations, field, filterValue)) {
        return false;
      }
    }

    return true;
  }
}

function matchEvaluationField(
  evaluations: EvaluationRunData[],
  field: string,
  filterValue: unknown,
): boolean {
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) {
      return true;
    }

    return matchEvaluatorIdFilter(evaluations, field, filterValue);
  }

  if (typeof filterValue !== "object" || filterValue === null) {
    return false;
  }

  for (const [evaluatorId, subValue] of Object.entries(filterValue)) {
    const forEvaluator = evaluations.filter((e) => e.evaluatorId === evaluatorId);
    if (forEvaluator.length === 0) {
      return false;
    }

    if (!matchKeyedEvaluationValues(forEvaluator, field, subValue)) {
      return false;
    }
  }

  return true;
}

function matchKeyedEvaluationValues(
  evaluations: EvaluationRunData[],
  field: string,
  subValue: unknown,
): boolean {
  if (Array.isArray(subValue)) {
    return subValue.length === 0 || matchEvaluationValues(evaluations, field, subValue);
  }

  if (typeof subValue !== "object" || subValue === null) {
    return true;
  }

  for (const values of Object.values(subValue)) {
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    if (!matchEvaluationValues(evaluations, field, values)) {
      return false;
    }
  }

  return true;
}

/**
 * A verdict is only real once the evaluation completed — `passed: false` can
 * accompany `status: "error"`, so without this guard "passed = false" pages
 * for what is actually a provider timeout (#6833); use `evaluations.state` instead.
 */
function hasVerdict(e: EvaluationRunData): boolean {
  return e.status === "processed";
}

function matchEvaluatorIdFilter(
  evaluations: EvaluationRunData[],
  field: string,
  evaluatorIds: unknown[],
): boolean {
  switch (field) {
    case "evaluations.evaluator_id":
      return evaluations.some((e) => evaluatorIds.includes(e.evaluatorId));

    case "evaluations.evaluator_id.guardrails_only":
      return evaluations.some((e) => evaluatorIds.includes(e.evaluatorId) && e.isGuardrail);

    case "evaluations.evaluator_id.has_passed":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && hasVerdict(e) && e.passed !== null,
      );

    case "evaluations.evaluator_id.has_score":
      return evaluations.some(
        (e) => evaluatorIds.includes(e.evaluatorId) && hasVerdict(e) && e.score !== null,
      );

    case "evaluations.evaluator_id.has_label":
      return evaluations.some(
        (e) =>
          evaluatorIds.includes(e.evaluatorId) &&
          hasVerdict(e) &&
          e.label !== null &&
          e.label !== "",
      );

    default:
      return false;
  }
}

function matchEvaluationValues(
  evaluations: EvaluationRunData[],
  field: string,
  values: unknown[],
): boolean {
  switch (field) {
    case "evaluations.passed":
      return evaluations.some(
        (e) => hasVerdict(e) && e.passed !== null && values.includes(String(e.passed)),
      );

    case "evaluations.score":
      return evaluations.some(
        (e) => hasVerdict(e) && e.score !== null && values.includes(String(e.score)),
      );

    case "evaluations.state":
      return evaluations.some((e) => values.includes(e.status));

    case "evaluations.label":
      return evaluations.some((e) => hasVerdict(e) && e.label !== null && values.includes(e.label));

    default:
      return false;
  }
}
