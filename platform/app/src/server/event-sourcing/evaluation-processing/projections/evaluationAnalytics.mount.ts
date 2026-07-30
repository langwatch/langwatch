import {
  ConfigurationError,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";

/**
 * The `evaluationAnalytics` fold's mount (ADR-106).
 *
 * `fold` + `replace` + `scope: "aggregate"` + `collapse: "batch"`: a fold
 * must be aggregate-scoped (`fold-scope-must-be-aggregate`) and must read
 * prior state back, which only a `replace` store offers
 * (`fold-store-must-be-replace`). `batch` rather than `none`: several
 * lifecycle events for one evaluation (`started`, `reported`) may coalesce
 * into a single load/apply/store cycle without changing the result —
 * coalescing a fold is a pure left-fold (ADR-100 §4) — so there is no reason
 * to force one round trip per event.
 *
 * Checked here, at module load, rather than left for a caller to remember —
 * ADR-106 decision 3: refusal happens at composition, not at the first
 * delivery.
 *
 * === A gap that existed when this file was first written, since closed ===
 *
 * `validateMount`/`Mount` were declared in `packages/event-sourcing/src/mount/`
 * but were NOT re-exported from that package's `src/index.ts` as of this
 * pipeline's initial rewrite — confirmed at the time by reading the file
 * directly, not assumed, and reported rather than routed around with a
 * reimplementation of the checker's rule table. The export has since landed
 * (a concurrent change to the shared package, not part of this pipeline's
 * directory), and this file now calls the real checker instead of arguing the
 * shape's legality in a comment. Kept as a citation for anyone who finds an
 * older copy of this file, or the sibling `log-processing/mount.ts`, holding
 * the same import before the export existed.
 */
export const evaluationAnalyticsMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

/**
 * Fails composition loudly if the mount above is ever edited into an illegal
 * shape. Called once, at module load.
 */
export function assertEvaluationAnalyticsMountIsLegal(): void {
  const violations = validateMount(evaluationAnalyticsMount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `evaluation-processing's evaluationAnalytics mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      {
        pipeline: "evaluation_processing",
        projection: "evaluationAnalytics",
        violations,
      },
    );
  }
}

assertEvaluationAnalyticsMountIsLegal();
