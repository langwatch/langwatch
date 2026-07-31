import type { RunOutcomeCounts } from "~/server/scenarios/run-outcome-summary";
import type { Block, ReportModel, ReportSection } from "../../report.types";

/**
 * Model builders for the render tests.
 *
 * The renderer is pure, so a fixture is the whole world it sees; building one
 * by hand here keeps each test's deviation from the baseline the only thing on
 * screen.
 */

export function makeCounts(
  overrides: Partial<RunOutcomeCounts> = {},
): RunOutcomeCounts {
  return {
    passedCount: 8,
    failedCount: 2,
    stalledCount: 0,
    cancelledCount: 0,
    inProgressCount: 0,
    queuedCount: 0,
    completedCount: 10,
    settledCount: 10,
    totalCount: 10,
    ...overrides,
  };
}

export function makeSection(
  overrides: Partial<ReportSection> = {},
): ReportSection {
  return {
    questionId: "what-failed",
    tier: "past",
    question: "What failed?",
    intent: "Group the failures by cause.",
    computed: [{ kind: "note", text: "Two scenarios failed.", tone: "fail" }],
    written: [],
    gap: null,
    ...overrides,
  };
}

export function makeModel(overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    meta: {
      projectId: "project-1",
      suiteName: "Checkout suite",
      batchRunId: "batch-1",
      generatedAt: "2026-07-29 10:00 UTC",
      withAnalysis: true,
    },
    tier: "verified",
    summary: {
      verdict: "2 scenarios failed out of 10.",
      tone: "warn",
      movement: "That is down 12 points on the run before it.",
      facts: [
        { label: "Scenarios", value: "10" },
        { label: "Took", value: "4s" },
        { label: "Cost", value: "$0.02" },
      ],
      topProblem: 'The most widespread failure is "confirms before charging".',
      caveat: null,
    },
    headline: {
      passRate: {
        value: 80,
        ci95: { low: 49, high: 94 },
        settled: 10,
        isTooFewToConclude: false,
        inconclusiveReason: null,
      },
      counts: makeCounts(),
    },
    sections: [makeSection()],
    integrity: {
      claimsDroppedUncited: 0,
      claimsDroppedUnresolvable: 0,
      claimsDroppedUnconfirmed: 0,
      notes: [],
    },
    ...overrides,
  };
}

/** One of every block variant, so a new variant fails a test rather than a reader. */
export const EVERY_BLOCK: Block[] = [
  {
    kind: "stats",
    stats: [{ label: "Scenarios", value: "10", hint: "in this run" }],
  },
  {
    kind: "bar",
    segments: [
      { label: "passed", value: 8, tone: "pass" },
      { label: "failed", value: 2, tone: "fail" },
    ],
  },
  {
    kind: "table",
    columns: ["Scenario", "Duration"],
    rows: [
      [
        { text: "Checkout with a coupon", tone: "pass" },
        { text: "1.2s", sortValue: 1200 },
      ],
    ],
  },
  { kind: "list", items: [{ text: "Refund flow", tone: "muted" }] },
  {
    kind: "groups",
    groups: [
      {
        title: "Agent skipped the confirmation step",
        subtitle: "3 scenarios",
        tone: "fail",
        detail: [{ label: "Judge reasoning", body: "It never confirmed." }],
        // Turn indices jump 0 -> 7, which is how a dropped middle reaches the
        // renderer: selection keeps the opening turn and the tail.
        transcripts: [
          {
            runId: "run-1",
            signatureId: "sig-1",
            scenarioName: "Checkout with a coupon",
            turns: [
              { index: 0, role: "user", content: "Apply my coupon." },
              { index: 7, role: "assistant", content: "Order placed." },
            ],
            omittedTurns: 6,
          },
        ],
      },
    ],
  },
  { kind: "note", text: "Nothing was left unattempted.", tone: "pass" },
  {
    kind: "claims",
    claims: [
      {
        id: "c1",
        text: "The agent skipped confirmation in three scenarios.",
        citations: [
          { kind: "run", runId: "run-1" },
          { kind: "criterion", criterionId: "crit-1" },
          { kind: "signature", signatureId: "sig-1" },
          { kind: "turn", runId: "run-1", turnIndex: 4 },
          { kind: "stat", path: "counts.failedCount" },
        ],
      },
    ],
  },
  {
    kind: "findings",
    findings: [
      {
        headline: "Confirmation is skipped under load",
        severity: "critical",
        computedSeverity: "high",
        consequence: "Customers are charged without seeing a summary.",
        claims: [
          { id: "c2", text: "Three runs charged early.", citations: [] },
        ],
      },
    ],
  },
  {
    kind: "artifacts",
    artifacts: [
      {
        artifactType: "scenario",
        title: "Confirm before charging",
        rationale: "Covers the gap the failures share.",
        body: "Given a cart\nWhen I check out\nThen I see a summary",
        claims: [],
      },
    ],
  },
];

/** A report whose written half is doing its best to escape into the page. */
export function makeMarkupModel(): ReportModel {
  return makeModel({
    sections: [
      makeSection({
        written: [
          {
            kind: "claims",
            claims: [
              {
                id: "c1",
                text: "<img src=x onerror=alert(1)>",
                citations: [{ kind: "run", runId: "run-1" }],
              },
            ],
          },
          {
            kind: "artifacts",
            artifacts: [
              {
                artifactType: "guardrail_rule",
                title: "Block early charges",
                rationale: "Every failure shares this shape.",
                body: "</script><script>alert(1)</script>",
                claims: [],
              },
            ],
          },
        ],
      }),
    ],
  });
}

/** The same markup in a scenario name and a suite name, where it reaches attributes too. */
export function makeMarkupNameModel(name: string): ReportModel {
  return makeModel({
    meta: {
      projectId: "project-1",
      suiteName: name,
      batchRunId: "batch-1",
      generatedAt: "2026-07-29 10:00 UTC",
      withAnalysis: true,
    },
    sections: [
      makeSection({
        computed: [
          {
            kind: "table",
            columns: ["Scenario"],
            rows: [[{ text: name, tone: "fail" }]],
          },
        ],
      }),
    ],
  });
}

export function makeEveryBlockModel(): ReportModel {
  return makeModel({ sections: [makeSection({ computed: EVERY_BLOCK })] });
}

/** No model configured: the figures survive, the writing does not. */
export function makeFiguresOnlyModel(): ReportModel {
  return makeModel({
    tier: "figures_only",
    sections: [
      makeSection({ computed: EVERY_BLOCK, written: [] }),
      makeSection({
        questionId: "what-holds",
        tier: "present",
        question: "What holds?",
        intent: "Name the criteria that never failed.",
        computed: [{ kind: "note", text: "Refunds held.", tone: "pass" }],
      }),
    ],
  });
}

/** Three failures out of four — a rate here would be noise dressed as a finding. */
export function makeSmallSampleModel(): ReportModel {
  return makeModel({
    headline: {
      passRate: {
        value: 25,
        ci95: null,
        settled: 4,
        isTooFewToConclude: true,
        inconclusiveReason: "too_few_runs",
      },
      counts: makeCounts({
        passedCount: 1,
        failedCount: 3,
        completedCount: 4,
        settledCount: 4,
        totalCount: 4,
      }),
    },
  });
}

export function makeNothingSettledModel(): ReportModel {
  return makeModel({
    headline: {
      passRate: {
        value: null,
        ci95: null,
        settled: 0,
        isTooFewToConclude: false,
        inconclusiveReason: null,
      },
      counts: makeCounts({
        passedCount: 0,
        failedCount: 0,
        inProgressCount: 4,
        completedCount: 0,
        settledCount: 0,
        totalCount: 4,
      }),
    },
  });
}
