import type { Citation, Claim, ReportEvidence } from "../report.types";

/**
 * Decides which model statements are allowed into the report.
 *
 * A model writing about a run will occasionally refer to a scenario that is not
 * in it, or to a turn past the end of a conversation, and will do so in a
 * sentence that reads exactly like the true ones. Asking a model to check that
 * is asking the same faculty that produced the error to notice it. So it is
 * checked here instead, mechanically, against the evidence the model was given.
 *
 * A statement that cites nothing is dropped. A statement that cites anything
 * that cannot be resolved is dropped WHOLE — not repaired, not reworded, not
 * partially kept — because a sentence with one invented reference is not
 * trustworthy in its other half either.
 *
 * This is the property that makes the document safe to forward, and it holds
 * without trusting the model at all.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/**
 * Statistics a claim may cite by path.
 *
 * An allowlist rather than an arbitrary walk of the evidence object: a path
 * that resolves by traversal would let a claim cite an internal field nobody
 * intended to publish, and would silently start accepting new paths whenever
 * the evidence shape grew.
 */
const CITABLE_STAT_PATHS = [
  "counts.totalCount",
  "counts.passedCount",
  "counts.failedCount",
  "counts.stalledCount",
  "counts.cancelledCount",
  "counts.settledCount",
  "counts.completedCount",
  "passRate.value",
  "passRate.settled",
  "batch.durationMs",
  "batch.totalCost",
  "truncation.failingRuns",
  "truncation.transcriptsIncluded",
] as const;

export function citationKey(citation: Citation): string {
  switch (citation.kind) {
    case "run":
      return `run:${citation.runId}`;
    case "criterion":
      return `criterion:${citation.criterionId}`;
    case "signature":
      return `signature:${citation.signatureId}`;
    case "turn":
      return `turn:${citation.runId}:${citation.turnIndex}`;
    case "stat":
      return `stat:${citation.path}`;
  }
}

/**
 * Every reference the evidence can support.
 *
 * Turns are enumerated per run rather than range-checked at lookup time, so a
 * citation pointing past the end of a conversation simply is not in the set —
 * one rule, applied the same way to every citation kind.
 */
export function buildCitationIndex({
  evidence,
}: {
  evidence: ReportEvidence;
}): Set<string> {
  const index = new Set<string>();

  for (const run of evidence.runs) {
    index.add(`run:${run.runId}`);
    for (let turn = 0; turn < run.turnCount; turn++) {
      index.add(`turn:${run.runId}:${turn}`);
    }
  }
  for (const criterion of evidence.criteria) {
    index.add(`criterion:${criterion.criterionId}`);
  }
  for (const signature of evidence.signatures) {
    index.add(`signature:${signature.signatureId}`);
  }
  for (const path of CITABLE_STAT_PATHS) {
    index.add(`stat:${path}`);
  }

  return index;
}

export interface ResolutionResult {
  kept: Claim[];
  droppedUncited: number;
  droppedUnresolvable: number;
}

export function resolveClaims({
  claims,
  index,
}: {
  claims: Claim[];
  index: Set<string>;
}): ResolutionResult {
  let droppedUncited = 0;
  let droppedUnresolvable = 0;
  const kept: Claim[] = [];

  for (const claim of claims) {
    if (claim.citations.length === 0) {
      droppedUncited++;
      continue;
    }
    if (claim.citations.some((citation) => !index.has(citationKey(citation)))) {
      droppedUnresolvable++;
      continue;
    }
    kept.push(claim);
  }

  return { kept, droppedUncited, droppedUnresolvable };
}
