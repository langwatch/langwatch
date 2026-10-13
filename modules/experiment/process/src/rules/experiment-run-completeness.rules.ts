import type { ExperimentRunCompleteness } from "@langwatch/experiment-contract";

type Counts = { dataset: number; evaluations: number };

const reached = (received: number, expected: number | null): boolean =>
  expected === null || received >= expected;

/**
 * Whether a read holds the whole run. Results are stored after they are reported and the finish
 * marker is not ordered after them, so an ended run is whole only once the stored rows and
 * verdicts reach the counts it reported. A run that reported none is taken at its end marker.
 */
export function deriveRunCompleteness({
  ended,
  received,
  expected,
}: {
  ended: boolean;
  received: Counts;
  expected: { dataset: number | null; evaluations: number | null };
}): ExperimentRunCompleteness {
  return {
    complete:
      ended &&
      reached(received.dataset, expected.dataset) &&
      reached(received.evaluations, expected.evaluations),
    dataset: { received: received.dataset, expected: expected.dataset },
    evaluations: { received: received.evaluations, expected: expected.evaluations },
  };
}
