/**
 * The blocks answering what is true now: clusters, severity, trust, coverage.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import {
  bySeverityDescending,
  computeSeverityPrior,
  severityRank,
} from "../evidence/severity";
import type { Block, ReportEvidence } from "../report.types";
import {
  plural,
  scenarioNameFor,
  trendClassificationById,
} from "./question-helpers";

/**
 * The criteria a group failed, named once each.
 *
 * A group spans scenarios and keeps each one's own criterion id, so the same
 * wording arrives once per scenario. Without deduping, a group titled "stays on
 * topic" lists "stays on topic" again underneath as a second failure.
 */
export function groupCriteriaTexts({
  signature,
  evidence,
}: {
  signature: ReportEvidence["signatures"][number];
  evidence: ReportEvidence;
}): string[] {
  return [
    ...new Set(
      signature.unmetCriterionIds
        .map(
          (id) =>
            evidence.criteria.find((fact) => fact.criterionId === id)?.text,
        )
        .filter((text): text is string => text !== undefined),
    ),
  ];
}

const NON_JUDGED_TITLES: Record<string, string> = {
  errored: "Errored before it could be judged",
  stalled: "Stopped reporting",
  cancelled: "Cancelled",
};

/**
 * The first sentence of an error, for telling two error groups apart.
 *
 * A run that errored has no criterion to name it by, so several distinct error
 * groups would otherwise carry the same title and read as duplicates of each
 * other — the reader cannot tell which of three "Errored before it could be
 * judged" rows is the one they are looking at.
 */
export function errorHeadline(error: string): string {
  // Ends the sentence on a full stop, not on any dot: errors name methods, and
  // splitting inside `langy.continueConversation` truncates the heading before
  // it reaches the part that says what went wrong.
  const firstLine =
    error
      .split(/\n|\.(?:\s|$)/)[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? "";
  if (firstLine.length === 0) return "";
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 80)}…`;
}

export function groupTitle({
  signature,
  criteria,
}: {
  signature: ReportEvidence["signatures"][number];
  criteria: string[];
}): string {
  if (signature.kind === "judged") {
    return criteria[0] ?? "Failed its criteria";
  }
  const base = NON_JUDGED_TITLES[signature.kind] ?? "Did not complete";
  const headline = signature.errorExample
    ? errorHeadline(signature.errorExample)
    : "";
  return headline === "" ? base : `${base}: ${headline}`;
}

export function clusterBlocks(evidence: ReportEvidence): Block[] {
  return [
    {
      kind: "groups",
      groups: evidence.signatures.map((signature) => {
        const criteria = groupCriteriaTexts({ signature, evidence });
        const scenarios = signature.scenarioIds
          .map((scenarioId) => scenarioNameFor({ evidence, scenarioId }))
          .join(", ");

        return {
          title: groupTitle({ signature, criteria }),
          subtitle: `${signature.runIds.length} ${
            signature.runIds.length === 1 ? "scenario" : "scenarios"
          }`,
          tone:
            signature.kind === "judged" ? ("fail" as const) : ("warn" as const),
          detail: [
            ...(criteria.length > 1
              ? [{ label: "Also failed", body: criteria.slice(1).join("; ") }]
              : []),
            // The example rather than the fingerprint: the fingerprint has had
            // every value replaced, so a JSON error reads as bare punctuation.
            ...(signature.errorExample
              ? [{ label: "Error", body: signature.errorExample }]
              : []),
            { label: "Scenarios", body: scenarios },
          ],
          // The conversations behind this group, so a reader can check the
          // grouping rather than take it on trust. "Why did it fail" is not
          // answerable from a criterion name alone.
          transcripts: evidence.transcripts.filter(
            (transcript) => transcript.signatureId === signature.signatureId,
          ),
        };
      }),
    },
  ];
}

export function severityBlocks(evidence: ReportEvidence): Block[] {
  const trendByCriterion = trendClassificationById(evidence);
  const ranked = evidence.signatures
    .map((signature) => ({
      signature,
      severity: computeSeverityPrior({
        signature,
        trendByCriterion,
        settledRuns: evidence.counts.settledCount,
      }),
    }))
    .sort((a, b) => bySeverityDescending(a.severity, b.severity));

  return [
    {
      kind: "table",
      columns: ["Failure", "Severity", "Scenarios affected", "Kind"],
      rows: ranked.map(({ signature, severity }) => [
        {
          text:
            signature.unmetCriterionIds
              .map(
                (id) =>
                  evidence.criteria.find((fact) => fact.criterionId === id)
                    ?.text,
              )
              .filter(Boolean)
              .join("; ") ||
            (signature.errorExample
              ? errorHeadline(signature.errorExample)
              : "") ||
            "Did not complete",
        },
        {
          text: severity,
          tone:
            severity === "critical" || severity === "high" ? "fail" : "warn",
          sortValue: severityRank(severity),
        },
        {
          text: String(signature.runIds.length),
          sortValue: signature.runIds.length,
        },
        { text: signature.kind },
      ]),
    },
  ];
}

export function trustBlocks(evidence: ReportEvidence): Block[] {
  const unreliable = evidence.trend.filter(
    (fact) => fact.classification === "unreliable",
  );
  const notJudged = evidence.signatures.filter(
    (signature) => signature.kind !== "judged",
  );
  const blocks: Block[] = [];

  const settledLabel = `${evidence.passRate.settled} ${
    evidence.passRate.settled === 1 ? "scenario" : "scenarios"
  }`;
  if (evidence.passRate.inconclusiveReason === "too_few_runs") {
    blocks.push({
      kind: "note",
      tone: "warn",
      text: `This run settled ${settledLabel} — too few runs to draw a conclusion from a percentage. Read the individual outcomes instead.`,
    });
  }
  if (evidence.passRate.inconclusiveReason === "spread_too_wide") {
    blocks.push({
      kind: "note",
      tone: "warn",
      text: `This run settled ${settledLabel}, which is enough to measure — but the outcomes varied so much that the rate does not pin down how the agent behaves. That spread is itself the finding: it points at inconsistency rather than at a missing sample.`,
    });
  }

  if (unreliable.length > 0) {
    blocks.push({
      kind: "list",
      items: unreliable.map((fact) => ({
        text: `${fact.text} — has passed and failed repeatedly across recent runs`,
        tone: "warn" as const,
      })),
    });
  }

  if (notJudged.length > 0) {
    blocks.push({
      kind: "note",
      tone: "warn",
      text: `${notJudged.reduce(
        (sum, signature) => sum + signature.runIds.length,
        0,
      )} scenarios never reached a verdict, so this run says less about the agent than the counts suggest.`,
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      kind: "note",
      tone: "pass",
      text: "Every scenario reached a verdict and no criterion is behaving erratically.",
    });
  }

  return blocks;
}

export function coverageBlocks(evidence: ReportEvidence): Block[] {
  const notRun = evidence.coverage.scenariosNotRun;

  if (notRun.length > 0) {
    return [
      {
        kind: "note",
        tone: "warn",
        text: "These scenarios ran in previous runs but not in this one, so nothing here says whether they still pass:",
      },
      {
        kind: "list",
        // By scenario, not by run: a scenario that stopped running appears once
        // per prior run that had it, so the same name was arriving three times
        // over and reading as a rendering fault rather than as three runs.
        items: [...new Set(notRun.map((scenario) => scenario.name))].map(
          (name) => ({ text: name, tone: "warn" as const }),
        ),
      },
    ];
  }

  // Deliberately not "nothing was left unattempted". The run record does not
  // carry the suite's roster, so a scenario that has never run in any visible
  // run is invisible here — claiming full coverage would be asserting something
  // this report cannot see.
  return [
    {
      kind: "note",
      tone: "pass",
      text:
        evidence.priorBatches.length > 0
          ? `This run executed every scenario that ran in previous runs, ${plural(evidence.coverage.scenariosInSuite.length, "scenario", "scenarios")} in all.`
          : `This run executed ${evidence.coverage.scenariosInSuite.length} scenarios. With no earlier run to compare against, there is nothing to say about what it might have skipped.`,
    },
  ];
}

// ============================================================================
// The registry
// ============================================================================
