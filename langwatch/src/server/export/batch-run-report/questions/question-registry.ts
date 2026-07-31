import {
  bySeverityDescending,
  computeSeverityPrior,
} from "../evidence/severity";
import type {
  Block,
  QuestionTier,
  ReportEvidence,
  TrendClassification,
} from "../report.types";

/**
 * The questions a run report answers.
 *
 * The unit here is a QUESTION, not a section. Adding analysis later means
 * appending one descriptor: the prompt is generated from this list, the model's
 * answers are keyed by question id, the checker sweeps this list to decide what
 * went unanswered, and the renderer dispatches on block kind. A question that
 * reuses an existing block shape needs no rendering code at all.
 *
 * That extensibility stops at a genuinely new block SHAPE, which costs a
 * variant in report.types.ts plus a renderer. That is the honest boundary.
 *
 * Every descriptor carries `computed`, which runs with no model and always
 * renders. The model adds naming, grouping and prose on top of it — it is not
 * what makes the section exist.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

export type Applicability =
  | { applicable: true }
  | { applicable: false; reason: string };

export interface QuestionDescriptor {
  /** Stable forever: it is the section anchor and how the model refers back. */
  id: string;
  tier: QuestionTier;
  question: string;
  /** Why a reader cares. Rendered under the heading. */
  intent: string;
  /** Deterministic precondition. When false the section renders as a gap. */
  applicability: (evidence: ReportEvidence) => Applicability;
  /** Always rendered, model or no model. */
  computed: (evidence: ReportEvidence) => Block[];
}

const TREND_LABELS: Record<TrendClassification, string> = {
  regression: "broke since the last run",
  fixed: "fixed since the last run",
  long_standing: "has been failing for a while",
  unreliable: "keeps changing its mind",
  new: "not seen before",
  stable_pass: "holding",
  stable_fail: "still failing",
};

function hasPriorRuns(evidence: ReportEvidence): Applicability {
  return evidence.priorBatches.length > 0
    ? { applicable: true }
    : {
        applicable: false,
        // Not "this is the first run": the report sees a bounded window of
        // history, so finding nothing earlier is a fact about what was read,
        // not about the suite. Claiming primacy would be asserting something
        // the evidence cannot support.
        reason:
          "No earlier run of this suite was available to compare against.",
      };
}

function hasFailures(evidence: ReportEvidence): Applicability {
  return evidence.signatures.length > 0
    ? { applicable: true }
    : {
        applicable: false,
        reason: "Nothing failed in this run.",
      };
}

function always(): Applicability {
  return { applicable: true };
}

function trendClassificationById(
  evidence: ReportEvidence,
): Map<string, TrendClassification> {
  return new Map(
    evidence.trend.map((fact) => [fact.criterionId, fact.classification]),
  );
}

function scenarioNameFor({
  evidence,
  scenarioId,
}: {
  evidence: ReportEvidence;
  scenarioId: string;
}): string {
  return (
    evidence.runs.find((run) => run.scenarioId === scenarioId)?.scenarioName ??
    scenarioId
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ============================================================================
// Past
// ============================================================================

/**
 * Pass rate per run, oldest first, this run last.
 *
 * Runs whose rate is unknown are left out rather than drawn as zero — a run
 * that never settled is not a run that failed, and plotting it as one invents
 * a collapse. Ordered by when each run happened, so the line reads left to
 * right in the order they were seen.
 */
function trendPoints(
  evidence: ReportEvidence,
): { label: string; value: number }[] {
  const earlier = [...evidence.priorBatches]
    .sort((a, b) => a.startedAt - b.startedAt)
    .filter((batch) => batch.passRate !== null)
    .map((batch) => ({
      label: batch.batchRunId,
      value: batch.passRate as number,
    }));

  return evidence.passRate.value === null
    ? earlier
    : [...earlier, { label: "This run", value: evidence.passRate.value }];
}

function outcomeBlocks(evidence: ReportEvidence): Block[] {
  const { counts } = evidence;
  const blocks: Block[] = [
    {
      kind: "stats",
      stats: [
        { label: "Scenarios", value: String(counts.totalCount) },
        { label: "Passed", value: String(counts.passedCount) },
        { label: "Failed", value: String(counts.failedCount) },
        ...(counts.stalledCount > 0
          ? [{ label: "Stalled", value: String(counts.stalledCount) }]
          : []),
        ...(counts.cancelledCount > 0
          ? [{ label: "Cancelled", value: String(counts.cancelledCount) }]
          : []),
        { label: "Took", value: formatDuration(evidence.batch.durationMs) },
      ],
    },
    {
      kind: "bar",
      segments: [
        { label: "Passed", value: counts.passedCount, tone: "pass" },
        { label: "Failed", value: counts.failedCount, tone: "fail" },
        { label: "Stalled", value: counts.stalledCount, tone: "warn" },
        { label: "Cancelled", value: counts.cancelledCount, tone: "muted" },
      ].filter((segment) => segment.value > 0) as {
        label: string;
        value: number;
        tone: "pass" | "fail" | "warn" | "muted";
      }[],
    },
    {
      kind: "table",
      columns: ["Scenario", "Outcome", "Criteria met", "Turns", "Took"],
      rows: evidence.runs.map((run) => [
        { text: run.scenarioName },
        {
          text: run.status,
          tone:
            run.category === "success"
              ? ("pass" as const)
              : run.category === "failure"
                ? ("fail" as const)
                : ("warn" as const),
        },
        {
          text: `${run.metCriteria.length}/${run.metCriteria.length + run.unmetCriteria.length}`,
          sortValue: run.metCriteria.length,
        },
        { text: String(run.turnCount), sortValue: run.turnCount },
        { text: formatDuration(run.durationMs), sortValue: run.durationMs },
      ]),
    },
  ];

  // This run's rate in the company of the ones before it. A single figure
  // cannot say whether 25% is a collapse or the usual, which is the first
  // thing a reader wants to know about it.
  const history = trendPoints(evidence);
  if (history.length > 1) {
    blocks.push({ kind: "trend", points: history });
  }

  if (evidence.stillRunning) {
    blocks.unshift({
      kind: "note",
      tone: "warn",
      text: "Some scenarios had not finished when this report was produced, so these figures cover only the ones that had.",
    });
  }

  return blocks;
}

function trendTable({
  evidence,
  classifications,
  emptyText,
}: {
  evidence: ReportEvidence;
  classifications: TrendClassification[];
  emptyText: string;
}): Block[] {
  const matching = evidence.trend.filter((fact) =>
    classifications.includes(fact.classification),
  );

  if (matching.length === 0) {
    return [{ kind: "note", text: emptyText, tone: "muted" }];
  }

  return [
    {
      kind: "table",
      columns: ["Criterion", "Scenario", "Status", "Runs"],
      rows: matching.map((fact) => [
        { text: fact.text },
        {
          text: scenarioNameFor({ evidence, scenarioId: fact.scenarioId }),
        },
        { text: TREND_LABELS[fact.classification] },
        { text: String(fact.streakBatches), sortValue: fact.streakBatches },
      ]),
    },
  ];
}

function streakBlocks(evidence: ReportEvidence): Block[] {
  const holding = evidence.coverage.neverFailed;
  if (holding.length === 0) {
    return [
      {
        kind: "note",
        tone: "muted",
        text: "No criterion has come through every run without failing at least once.",
      },
    ];
  }

  // Criterion identity is scoped to its scenario, so one criterion worded the
  // same way across five scenarios is five entries here. Listing it five times
  // reads as a rendering fault; it is one thing that is holding.
  const byText = new Map<string, { scenarios: number; batches: number }>();
  for (const entry of holding) {
    const seen = byText.get(entry.text);
    byText.set(entry.text, {
      scenarios: (seen?.scenarios ?? 0) + 1,
      batches: Math.max(seen?.batches ?? 0, entry.batches),
    });
  }

  return [
    {
      kind: "list",
      items: [...byText].map(([text, { scenarios, batches }]) => ({
        text: [
          text,
          scenarios > 1 ? ` — across ${scenarios} scenarios,` : " —",
          batches > 1 ? ` held for ${batches} runs` : " held in this run",
        ].join(""),
        tone: "pass" as const,
      })),
    },
  ];
}

// ============================================================================
// Present
// ============================================================================

/**
 * The criteria a group failed, named once each.
 *
 * A group spans scenarios and keeps each one's own criterion id, so the same
 * wording arrives once per scenario. Without deduping, a group titled "stays on
 * topic" lists "stays on topic" again underneath as a second failure.
 */
function groupCriteriaTexts({
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
function errorHeadline(error: string): string {
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

function groupTitle({
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

function clusterBlocks(evidence: ReportEvidence): Block[] {
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

function severityBlocks(evidence: ReportEvidence): Block[] {
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
          sortValue: severity,
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

function trustBlocks(evidence: ReportEvidence): Block[] {
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

function coverageBlocks(evidence: ReportEvidence): Block[] {
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
        items: notRun.map((scenario) => ({
          text: scenario.name,
          tone: "warn" as const,
        })),
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
          ? `This run executed every one of the ${evidence.coverage.scenariosInSuite.length} scenarios that ran in previous runs.`
          : `This run executed ${evidence.coverage.scenariosInSuite.length} scenarios. With no earlier run to compare against, there is nothing to say about what it might have skipped.`,
    },
  ];
}

// ============================================================================
// The registry
// ============================================================================

export const QUESTION_REGISTRY: QuestionDescriptor[] = [
  {
    id: "past.outcome",
    tier: "past",
    question: "What happened in this run?",
    intent: "The outcome, before any interpretation of it.",
    applicability: always,
    computed: outcomeBlocks,
  },
  {
    id: "past.regressions",
    tier: "past",
    question: "What broke that used to hold?",
    intent:
      "A criterion that passed last time and fails now points at a change you can still connect to a cause.",
    applicability: hasPriorRuns,
    computed: (evidence) =>
      trendTable({
        evidence,
        classifications: ["regression"],
        emptyText: "Nothing that passed in the previous run is failing now.",
      }),
  },
  {
    id: "past.fixed",
    tier: "past",
    question: "What now passes that used to fail?",
    intent: "Confirmation that a change did what it was meant to.",
    applicability: hasPriorRuns,
    computed: (evidence) =>
      trendTable({
        evidence,
        classifications: ["fixed"],
        emptyText: "Nothing that was failing has started passing.",
      }),
  },
  {
    id: "past.streaks",
    tier: "past",
    question: "What has held, and for how long?",
    intent:
      "A failure list cannot tell you what is working. This is the part you do not have to look at again.",
    applicability: always,
    computed: streakBlocks,
  },
  {
    id: "present.clusters",
    tier: "present",
    question: "Why did the failures happen?",
    intent:
      "Several failing scenarios are usually a smaller number of underlying problems.",
    applicability: hasFailures,
    computed: clusterBlocks,
  },
  {
    id: "present.severity",
    tier: "present",
    question: "Which failure matters most?",
    intent:
      "Ordered by consequence rather than by how many rows turned red, so the first thing you read is the thing to fix.",
    applicability: hasFailures,
    computed: severityBlocks,
  },
  {
    id: "present.trust",
    tier: "present",
    question: "Which of these results can I not trust?",
    intent:
      "Results that came from too small a sample, an erratic criterion, or a scenario that never reached a verdict.",
    applicability: always,
    computed: trustBlocks,
  },
  {
    id: "present.coverage",
    tier: "present",
    question: "What did this run not cover?",
    intent: "What was never attempted is invisible in a pass rate.",
    applicability: always,
    computed: coverageBlocks,
  },
  {
    id: "future.scenario",
    tier: "future",
    question: "What test should exist that does not?",
    intent: "A gap in coverage, written as a scenario you can add.",
    applicability: hasFailures,
    computed: () => [],
  },
  {
    id: "future.prompt",
    tier: "future",
    question: "What should the agent's instructions say?",
    intent: "Wording aimed at the failures above, not general advice.",
    applicability: hasFailures,
    computed: () => [],
  },
  {
    id: "future.guardrail",
    tier: "future",
    question: "What should be caught before it reaches the agent?",
    intent:
      "The failures worth stopping outside the model rather than inside it.",
    applicability: hasFailures,
    computed: () => [],
  },
];

/** Throws at module load if two questions share an id. */
function assertUniqueIds(): void {
  const seen = new Set<string>();
  for (const descriptor of QUESTION_REGISTRY) {
    if (seen.has(descriptor.id)) {
      throw new Error(
        `Duplicate run-report question id: ${descriptor.id}. Ids are stable identifiers — deprecate, never reuse.`,
      );
    }
    seen.add(descriptor.id);
  }
}
assertUniqueIds();
