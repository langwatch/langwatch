import { z } from "zod";

/** How the judge settled one criterion. @see specs/scenarios/judge-criterion-verdicts.feature */
export const SCENARIO_CRITERION_STATUSES = ["passed", "failed", "inconclusive"] as const;
export type ScenarioCriterionStatus = (typeof SCENARIO_CRITERION_STATUSES)[number];

/** One criterion as the judge settled it, with its own reasoning. */
export const scenarioCriterionResultSchema = z.object({
  criterion: z.string(),
  /** The criterion restated as a positive requirement; absent from older SDKs. */
  requirement: z.string().optional(),
  status: z.enum(SCENARIO_CRITERION_STATUSES),
  /** Why this status; for an inconclusive criterion, the evidence that was missing. */
  reasoning: z.string().default(""),
});
export type ScenarioCriterionResult = z.infer<typeof scenarioCriterionResultSchema>;

/**
 * The per-criterion view of a run's results: the entries it stored, then one
 * derived entry, with empty reasoning, for every listed criterion they miss.
 */
export function resolveCriterionResults({
  criteria = [],
  metCriteria,
  unmetCriteria,
  inconclusiveCriteria,
}: {
  criteria?: readonly ScenarioCriterionResult[];
  metCriteria: readonly string[];
  unmetCriteria: readonly string[];
  inconclusiveCriteria?: readonly string[];
}): ScenarioCriterionResult[] {
  const stored = new Set(criteria.map((result) => result.criterion));
  const inconclusive = new Set(inconclusiveCriteria ?? []);
  const derived = (criterion: string, status: ScenarioCriterionStatus) =>
    stored.has(criterion) ? [] : [{ criterion, status, reasoning: "" }];
  return [
    ...criteria,
    ...metCriteria.flatMap((criterion) => derived(criterion, "passed")),
    ...unmetCriteria.flatMap((criterion) =>
      derived(criterion, inconclusive.has(criterion) ? "inconclusive" : "failed"),
    ),
  ];
}

/** The inconclusive criteria of a run: the list it sent, else those its criteria mark so. */
export function resolveInconclusiveCriteria({
  criteria,
  inconclusiveCriteria,
}: {
  criteria?: readonly ScenarioCriterionResult[];
  inconclusiveCriteria?: readonly string[];
}): string[] {
  if (inconclusiveCriteria && inconclusiveCriteria.length > 0) return [...inconclusiveCriteria];
  return (criteria ?? [])
    .filter((result) => result.status === "inconclusive")
    .map((result) => result.criterion);
}
