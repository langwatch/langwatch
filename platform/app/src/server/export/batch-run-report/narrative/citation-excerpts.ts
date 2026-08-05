import { inline, quoted } from "../evidence/inline-text";
import type { Citation, ReportEvidence } from "../report.types";
import { citationKey } from "./citation-resolver";

/**
 * What each citable id actually says, in one line.
 *
 * The checker is given the whole evidence block, but a block runs to tens of
 * thousands of characters and a statement arrives with its run ids already
 * swapped for scenario names, so asking a model to find the line a sentence
 * rests on is asking it to do a lookup it will sometimes get wrong. These
 * excerpts put the cited line NEXT TO the statement, which is what turns "does
 * this sound plausible" into "does the evidence it points at say this".
 *
 * Rendered from the evidence objects with the same flattening the block uses,
 * so an excerpt carries the same text as the block's own line and cannot
 * introduce a line break the block would have removed.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/** How much of one turn's content an excerpt carries. */
const MAX_TURN_EXCERPT = 600;

export function buildCitationExcerpts({
  evidence,
}: {
  evidence: ReportEvidence;
}): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ...runExcerpts(evidence),
    ...turnExcerpts(evidence),
    ...criterionExcerpts(evidence),
    ...signatureExcerpts(evidence),
    ...statExcerpts(evidence),
  ]);
}

function runExcerpts(evidence: ReportEvidence): [string, string][] {
  return evidence.runs.map((run) => [
    citationKey({ kind: "run", runId: run.runId }),
    `scenario ${quoted(run.scenarioName)} ${run.status}, ${run.turnCount} turns` +
      (run.unmetCriteria.length > 0
        ? `, unmet: ${run.unmetCriteria.map(inline).join(" | ")}`
        : "") +
      (run.error ? `, error: ${inline(run.error)}` : ""),
  ]);
}

function turnExcerpts(evidence: ReportEvidence): [string, string][] {
  return evidence.transcripts.flatMap((transcript) =>
    transcript.turns.map((turn): [string, string] => [
      citationKey({
        kind: "turn",
        runId: transcript.runId,
        turnIndex: turn.index,
      }),
      `${quoted(transcript.scenarioName)} turn ${turn.index} (${turn.role}): ${truncate(
        inline(turn.content),
      )}`,
    ]),
  );
}

function criterionExcerpts(evidence: ReportEvidence): [string, string][] {
  return evidence.criteria.map((criterion) => [
    citationKey({ kind: "criterion", criterionId: criterion.criterionId }),
    `${quoted(criterion.text)} met ${criterion.metCount}, unmet ${criterion.unmetCount}`,
  ]);
}

function signatureExcerpts(evidence: ReportEvidence): [string, string][] {
  return evidence.signatures.map((signature) => [
    citationKey({ kind: "signature", signatureId: signature.signatureId }),
    `failure group ${signature.kind} over ${signature.runIds.length} runs` +
      (signature.unmetCriterionIds.length > 0
        ? `, unmet: ${signature.unmetCriterionIds.join(", ")}`
        : "") +
      (signature.errorExample
        ? `, error: ${quoted(signature.errorExample)}`
        : ""),
  ]);
}

function statExcerpts(evidence: ReportEvidence): [string, string][] {
  return statValues(evidence).map(([path, value]) => [
    citationKey({ kind: "stat", path }),
    value,
  ]);
}

/**
 * The citable statistics and what they currently read.
 *
 * Deliberately the same paths `CITABLE_STAT_PATHS` admits, so a statistic a
 * claim is allowed to cite is always a statistic the checker can be shown. A
 * test pins the two lists together.
 */
function statValues(evidence: ReportEvidence): [string, string][] {
  return [
    ["counts.totalCount", String(evidence.counts.totalCount)],
    ["counts.passedCount", String(evidence.counts.passedCount)],
    ["counts.failedCount", String(evidence.counts.failedCount)],
    ["counts.stalledCount", String(evidence.counts.stalledCount)],
    ["counts.cancelledCount", String(evidence.counts.cancelledCount)],
    ["counts.settledCount", String(evidence.counts.settledCount)],
    ["counts.completedCount", String(evidence.counts.completedCount)],
    [
      "passRate.value",
      evidence.passRate.value === null
        ? "not determinable"
        : `${evidence.passRate.value.toFixed(1)}%`,
    ],
    ["passRate.settled", String(evidence.passRate.settled)],
    ["batch.durationMs", String(evidence.batch.durationMs)],
    [
      "batch.totalCost",
      evidence.batch.totalCost === null
        ? "not recorded"
        : String(evidence.batch.totalCost),
    ],
    ["truncation.failingRuns", String(evidence.truncation.failingRuns)],
    [
      "truncation.transcriptsIncluded",
      String(evidence.truncation.transcriptsIncluded),
    ],
  ];
}

/**
 * One statement and the evidence it rests on, as the checker reads it.
 *
 * A citation whose id has no excerpt still appears, marked, rather than being
 * silently omitted: the checker's job includes noticing that a sentence points
 * at nothing, and a citation that quietly vanished would read as a sentence
 * with fewer claims than it made.
 */
export function renderClaimForCheck({
  id,
  text,
  citations,
  excerpts,
}: {
  id: string;
  text: string;
  citations: Citation[];
  excerpts: ReadonlyMap<string, string>;
}): string {
  const lines = [`${id}: ${inline(text)}`];
  for (const citation of citations) {
    const key = citationKey(citation);
    lines.push(
      `    cites ${key} -> ${excerpts.get(key) ?? "(no such item in the evidence)"}`,
    );
  }
  if (citations.length === 0) {
    lines.push("    cites nothing");
  }
  return lines.join("\n");
}

function truncate(value: string): string {
  return value.length > MAX_TURN_EXCERPT
    ? `${value.slice(0, MAX_TURN_EXCERPT)}…`
    : value;
}
