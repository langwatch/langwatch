import {
  ConfigurationError,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";

/**
 * This pipeline's three fold mounts (ADR-106). Each is checked at
 * composition time — `assertTopicClusteringMountsAreLegal` runs once, at
 * module load, mirroring `log-processing/mount.ts` — rather than left for a
 * caller to remember.
 *
 * All three declare the one legal fold shape: `store: "replace"` (a fold
 * reads its prior state back — `fold-store-must-be-replace`),
 * `scope: "aggregate"` (required for every fold —
 * `fold-scope-must-be-aggregate`), `collapse: "batch"` rather than `"none"`.
 * `"latest"` is refused outright for any fold
 * (`fold-collapse-must-not-be-latest` — a fold accumulates, so discarding
 * events to keep only the latest is a silent undercount), and this pipeline
 * chooses `"batch"` over the also-legal `"none"` deliberately: ADR-100
 * decision 4's coalescing is safe specifically BECAUSE a fold's apply is a
 * pure left-fold over whatever order the batch arrives in, which is exactly
 * the property this rewrite's order-invariance work
 * (`projections/*.ts`'s docblocks) establishes for all three. `"none"`
 * would leave the coalescing throughput ADR-100 default (500 events/batch)
 * unclaimed for no correctness reason.
 */

export const topicClusteringRunStatusMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

export const topicClusteringRunHistoryMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

export const topicModelMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

const MOUNTS = {
  topicClusteringRunStatus: topicClusteringRunStatusMount,
  topicClusteringRunHistory: topicClusteringRunHistoryMount,
  topicModel: topicModelMount,
} as const;

/** Fails composition loudly if any mount above is ever edited into an
 * illegal shape (ADR-106 decision 3: refusal happens at composition, not on
 * the first delivery). */
export function assertTopicClusteringMountsAreLegal(): void {
  const violations = Object.entries(MOUNTS).flatMap(([name, mount]) =>
    validateMount(mount).map((violation) => ({ name, ...violation })),
  );
  if (violations.length > 0) {
    throw new ConfigurationError(
      `topic-clustering-processing has illegal mounts: ${violations
        .map((v) => `${v.name}: ${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: "topic_clustering_processing", violations },
    );
  }
}
