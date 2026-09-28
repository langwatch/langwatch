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
 * The per-criterion view of a run's results: the entries it stored plus one derived
 * entry, with empty reasoning, for every listed criterion they miss, in declared order.
 */
export function deriveCriterionResults({
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
  const byCriterion = new Map(criteria.map((result) => [result.criterion, result]));
  const inconclusive = new Set(inconclusiveCriteria ?? []);
  const met = new Set(metCriteria);
  const order = mergeDeclaredOrder([
    criteria.map((result) => result.criterion),
    [...metCriteria],
    [...unmetCriteria],
  ]);
  return order.map(
    (criterion) =>
      byCriterion.get(criterion) ?? {
        criterion,
        status: listedStatusOf({ criterion, met, inconclusive }),
        reasoning: "",
      },
  );
}

function listedStatusOf({
  criterion,
  met,
  inconclusive,
}: {
  criterion: string;
  met: ReadonlySet<string>;
  inconclusive: ReadonlySet<string>;
}): ScenarioCriterionStatus {
  if (met.has(criterion)) return "passed";
  return inconclusive.has(criterion) ? "inconclusive" : "failed";
}

/**
 * One order holding every chain as a subsequence, each chain a slice of the declared
 * order. A criterion goes next once all it follows are placed; first seen wins ties.
 */
function mergeDeclaredOrder(chains: string[][]): string[] {
  const pending = [...new Set(chains.flat())];
  const follows = new Map(pending.map((criterion) => [criterion, new Set<string>()]));
  for (const chain of chains) {
    let previous: string | undefined;
    for (const criterion of chain) {
      if (previous !== undefined && previous !== criterion) follows.get(criterion)?.add(previous);
      previous = criterion;
    }
  }
  const placed = new Set<string>();
  while (placed.size < pending.length) {
    const unplaced = pending.filter((criterion) => !placed.has(criterion));
    const ready = unplaced.filter((criterion) =>
      [...(follows.get(criterion) ?? [])].every((before) => placed.has(before)),
    );
    const [next] = ready.length > 0 ? ready : unplaced;
    if (next === undefined) break;
    placed.add(next);
  }
  return [...placed];
}

/** The met, unmet and inconclusive criteria of a run: each list it sent, else its criteria's. */
export function deriveCriteriaLists({
  criteria = [],
  metCriteria = [],
  unmetCriteria = [],
  inconclusiveCriteria = [],
}: {
  criteria?: readonly ScenarioCriterionResult[];
  metCriteria?: readonly string[];
  unmetCriteria?: readonly string[];
  inconclusiveCriteria?: readonly string[];
}): { metCriteria: string[]; unmetCriteria: string[]; inconclusiveCriteria: string[] } {
  const withStatus = (statuses: readonly ScenarioCriterionStatus[]) =>
    criteria.filter((result) => statuses.includes(result.status)).map((result) => result.criterion);
  const listOr = (sent: readonly string[], derived: () => string[]) =>
    sent.length > 0 ? [...sent] : derived();
  return {
    metCriteria: listOr(metCriteria, () => withStatus(["passed"])),
    unmetCriteria: listOr(unmetCriteria, () => withStatus(["failed", "inconclusive"])),
    inconclusiveCriteria: listOr(inconclusiveCriteria, () => withStatus(["inconclusive"])),
  };
}
