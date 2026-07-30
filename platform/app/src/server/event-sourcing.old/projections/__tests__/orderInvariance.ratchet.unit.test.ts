import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The shrink-only ratchet behind {@link assertOrderInvariant}, in the same idiom
 * as `LEGACY_INERT`, `KNOWN_RULE1_VIOLATIONS` and `tools/migrationorder`.
 *
 * Most folds declare `refoldOnOutOfOrder: false`, which IS the claim that the
 * fold reaches the same state whichever order its events arrive in. On most of
 * them that claim has never been checked — the shape of the `simulationRunState`
 * bug. Turning the property into a gate today would fail most folds at once and
 * would block this library on an eight-fold fix programme, so the gap is
 * recorded here instead: visible, enumerated, and only ever shrinking.
 *
 * To shrink it: write the fold's order-invariance proof with
 * `assertOrderInvariant`, then move its file from UNPROVEN to PROVEN. The
 * completeness check below means a NEW fold cannot appear without landing in one
 * list or the other, so the gap can never quietly grow by omission.
 */

/** Folds with an order-invariance proof under `__tests__`. */
const PROVEN_ORDER_INVARIANT: readonly string[] = [
  // `codingAgentSession.orderInvariance.unit.test.ts` — every ordering of a
  // five-contribution session, fourteen named invariants.
  "codingAgentSession.foldProjection.ts",
  // Pre-existing proofs, in each fold's own pipeline, predating this harness.
  "experimentRunState.foldProjection.ts",
  "simulationRunState.foldProjection.ts",
];

/**
 * Folds this harness has not proven order-invariant. Two different reasons, and
 * neither means "known broken":
 *
 * - the fold declares `refoldOnOutOfOrder: false`, which IS the claim, and
 *   nobody has checked it (`traceAnalytics`, `traceSummary`, and the langy and
 *   topic-clustering folds);
 * - the fold's ordering contract is the ACCEPTED cursor rather than
 *   commutativity (`eventOrdering: "acceptedAt"` on `evaluationRun` and
 *   `evaluationAnalytics`). Its last-write-wins fields are meant to follow the
 *   order the log accepted, so shuffle-invariance is the wrong property to
 *   demand of it; the right one is invariance under any order CONSISTENT with
 *   the accepted cursor, which this harness does not yet express.
 */
const UNPROVEN_ORDER_INVARIANT: readonly string[] = [
  "evaluationAnalytics.foldProjection.ts",
  "evaluationRun.foldProjection.ts",
  "langyConversationState.foldProjection.ts",
  "langyConversationTurn.foldProjection.ts",
  "topicClusteringRunHistory.foldProjection.ts",
  "topicClusteringRunStatus.foldProjection.ts",
  "topicModel.foldProjection.ts",
  "traceAnalytics.foldProjection.ts",
  "traceSummary.foldProjection.ts",
];

const PIPELINES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "pipelines",
);

function foldProjectionFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...foldProjectionFiles(path));
      continue;
    }
    if (entry.endsWith(".foldProjection.ts")) found.push(entry);
  }
  return found;
}

describe("order-invariance ratchet", () => {
  const folds = foldProjectionFiles(PIPELINES).sort();

  describe("given every fold projection in the repository", () => {
    it("accounts for each one as proven or explicitly unproven", () => {
      const accounted = [
        ...PROVEN_ORDER_INVARIANT,
        ...UNPROVEN_ORDER_INVARIANT,
      ].sort();
      // A new fold lands in neither list and fails here, so the gap cannot grow
      // by omission — only by someone writing the fold's name down.
      expect(accounted).toEqual(folds);
    });

    it("never lists a fold as both proven and unproven", () => {
      const proven = new Set(PROVEN_ORDER_INVARIANT);
      expect(
        UNPROVEN_ORDER_INVARIANT.filter((fold) => proven.has(fold)),
      ).toEqual([]);
    });
  });
});
