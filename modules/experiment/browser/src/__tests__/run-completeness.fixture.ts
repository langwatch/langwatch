import type { ExperimentRunCompleteness } from "@langwatch/experiment-contract";

/** A finished run from a reporter that sent no counts: whole, with unknown totals. */
export const WHOLE_RUN_COMPLETENESS: ExperimentRunCompleteness = {
  complete: true,
  dataset: { received: 0, expected: null },
  evaluations: { received: 0, expected: null },
};
