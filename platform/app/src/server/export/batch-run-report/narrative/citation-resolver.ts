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
 * citation pointing past the end of a conversation simply is not in the set:
 * one rule, applied the same way to every citation kind.
 *
 * The turns come from the transcripts that were actually selected, not from
 * each run's `turnCount`. A long conversation is truncated before the model
 * sees it, so indexing the full count would admit citations to turns it was
 * never shown, which is precisely the fabrication the citation gate exists to
 * stop. A run with no transcript selected contributes no turns at all.
 */
export function buildCitationIndex({
  evidence,
}: {
  evidence: ReportEvidence;
}): Set<string> {
  const index = new Set<string>();

  for (const run of evidence.runs) {
    index.add(`run:${run.runId}`);
  }
  for (const transcript of evidence.transcripts) {
    for (const turn of transcript.turns) {
      index.add(`turn:${transcript.runId}:${turn.index}`);
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

/**
 * Swaps run ids out of a sentence for the scenario each one ran.
 *
 * The model is asked to name scenarios rather than ids and mostly does, but
 * "mostly" leaves a page where some sentences read as prose and others as
 * database keys. The id is not lost: it is in the citation underneath, which is
 * where a reader who wants it looks. In the sentence it is the same string
 * twice over, and the half nobody can read.
 *
 * Longest id first, so one id that contains another cannot be half-replaced.
 */
export function humaniseRunIds({
  text,
  evidence,
}: {
  text: string;
  evidence: ReportEvidence;
}): string {
  const byLongestId = [...evidence.runs].sort(
    (a, b) => b.runId.length - a.runId.length,
  );

  return byLongestId.reduce(
    (sentence, run) =>
      run.scenarioName && run.scenarioName !== run.runId
        ? sentence.split(run.runId).join(run.scenarioName)
        : sentence,
    text,
  );
}

/**
 * The strict citation a draft citation describes, or null when it names none.
 *
 * The model is allowed to send a citation missing its id — see
 * `draftCitationSchema` — because rejecting it at parse time costs the whole
 * report. It costs the citation here instead, and a claim left with none is
 * dropped by the rule that was already there.
 */
type DraftCitation = {
  kind: string;
  runId?: string;
  criterionId?: string;
  signatureId?: string;
  turnIndex?: number;
  path?: string;
};

/**
 * What each kind of citation needs before it points at anything.
 *
 * One entry per kind, each returning null when its own required fields are
 * missing, so adding a kind is one entry rather than one more branch.
 */
const CITATION_BUILDERS: Record<
  string,
  (draft: DraftCitation) => Citation | null
> = {
  run: (draft) => (draft.runId ? { kind: "run", runId: draft.runId } : null),
  criterion: (draft) =>
    draft.criterionId
      ? { kind: "criterion", criterionId: draft.criterionId }
      : null,
  signature: (draft) =>
    draft.signatureId
      ? { kind: "signature", signatureId: draft.signatureId }
      : null,
  turn: (draft) =>
    draft.runId && draft.turnIndex !== undefined
      ? { kind: "turn", runId: draft.runId, turnIndex: draft.turnIndex }
      : null,
  stat: (draft) => (draft.path ? { kind: "stat", path: draft.path } : null),
};

export function toCitation(draft: DraftCitation): Citation | null {
  return CITATION_BUILDERS[draft.kind]?.(draft) ?? null;
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
