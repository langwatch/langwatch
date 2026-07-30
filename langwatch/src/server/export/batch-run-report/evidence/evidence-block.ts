import type { ReportEvidence, SelectedTranscript } from "../report.types";

/**
 * Renders the evidence as the exact text both model passes are given.
 *
 * Every id a claim is allowed to cite appears here verbatim, so writing a valid
 * citation is copying rather than recall. The checker is handed the byte-identical
 * string, so the two passes provably reasoned over the same facts — rebuilding it
 * for the second pass would let them drift apart in ways nothing would catch.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
export function buildEvidenceBlock({
  evidence,
  transcripts,
}: {
  evidence: ReportEvidence;
  transcripts: SelectedTranscript[];
}): string {
  return [
    ...runSection(evidence),
    "",
    ...criteriaSection(evidence),
    "",
    ...failureGroupsSection(evidence),
    "",
    ...trendSection(evidence),
    "",
    ...scenariosSection(evidence),
    "",
    ...conversationsSection({ evidence, transcripts }),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function runSection(evidence: ReportEvidence): string[] {
  return [
    "## RUN",
    "(context only — nothing on this line is a citable id; cite run_id values from ## SCENARIOS instead)",
    `suite_name: ${evidence.batch.suiteName ?? "(unnamed)"}`,
    `scenarios: ${evidence.counts.totalCount}`,
    `passed: ${evidence.counts.passedCount}  failed: ${evidence.counts.failedCount}  stalled: ${evidence.counts.stalledCount}  cancelled: ${evidence.counts.cancelledCount}`,
    `settled: ${evidence.counts.settledCount}`,
    evidence.passRate.value === null
      ? "pass rate: not yet determinable"
      : `pass rate: ${evidence.passRate.value.toFixed(1)}% of ${evidence.passRate.settled} settled${
          evidence.passRate.tooFewToConclude
            ? " (TOO FEW RUNS TO CONCLUDE — do not state this as a rate)"
            : ""
        }`,
    evidence.stillRunning
      ? "NOTE: some scenarios had not finished; these figures cover only those that had."
      : "",
  ];
}

function criteriaSection(evidence: ReportEvidence): string[] {
  return [
    "## CRITERIA",
    ...evidence.criteria.map(
      (fact) =>
        `${fact.criterionId}  met ${fact.metCount} / unmet ${fact.unmetCount}  "${fact.text}"`,
    ),
  ];
}

function failureGroupsSection(evidence: ReportEvidence): string[] {
  return [
    "## FAILURE GROUPS",
    ...evidence.signatures.map(
      (signature) =>
        `${signature.signatureId}  kind=${signature.kind}  runs=${signature.runIds.length}  scenarios=${signature.scenarioIds.length}` +
        (signature.unmetCriterionIds.length > 0
          ? `  unmet=[${signature.unmetCriterionIds.join(",")}]`
          : "") +
        (signature.errorShape ? `  error="${signature.errorShape}"` : ""),
    ),
  ];
}

function trendSection(evidence: ReportEvidence): string[] {
  return [
    "## TREND",
    ...evidence.trend.map(
      (fact) =>
        `${fact.criterionId}  ${fact.classification}  streak=${fact.streakBatches}  "${fact.text}"`,
    ),
    evidence.priorBatches.length === 0
      ? "(this is the first run of this suite — there is nothing to compare against)"
      : `(compared against ${evidence.priorBatches.length} previous runs)`,
  ];
}

function scenariosSection(evidence: ReportEvidence): string[] {
  return [
    "## SCENARIOS",
    '(run_id is the only value citable as a "run" citation)',
    ...evidence.runs.map(
      (run) =>
        `run_id=${run.runId}  scenario="${run.scenarioName}"  ${run.status}  turns=${run.turnCount}` +
        (run.unmetCriteria.length > 0
          ? `\n    unmet: ${run.unmetCriteria.join(" | ")}`
          : "") +
        (run.reasoning ? `\n    judge: ${run.reasoning}` : "") +
        (run.error ? `\n    error: ${run.error}` : ""),
    ),
  ];
}

function conversationsSection({
  evidence,
  transcripts,
}: {
  evidence: ReportEvidence;
  transcripts: SelectedTranscript[];
}): string[] {
  return [
    "## CONVERSATIONS",
    transcripts.length === 0
      ? "(none included)"
      : `(${transcripts.length} of ${evidence.truncation.failingRuns} failing conversations, covering ${evidence.truncation.signaturesCovered} of ${evidence.truncation.signaturesTotal} distinct failure groups)`,
    ...transcripts.map((transcript) =>
      [
        `--- run_id=${transcript.runId} scenario="${transcript.scenarioName}" group=${transcript.signatureId}`,
        transcript.omittedTurns > 0
          ? `    [${transcript.omittedTurns} middle turns omitted]`
          : "",
        ...transcript.turns.map(
          (turn) => `    turn ${turn.index} (${turn.role}): ${turn.content}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ];
}
