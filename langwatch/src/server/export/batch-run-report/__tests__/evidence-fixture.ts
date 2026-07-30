import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ReportEvidence } from "../report.types";

const FIXTURE_RUNS: ReportEvidence["runs"] = [
  {
    runId: "run_1",
    scenarioId: "scen_1",
    scenarioName: "Refund escalation",
    status: ScenarioRunStatus.FAILED,
    category: "failure",
    verdict: "failure",
    reasoning: "The agent revealed the discount ceiling.",
    metCriteria: [],
    unmetCriteria: ["stays polite"],
    error: null,
    turnCount: 3,
    durationMs: 2_100,
    cost: 0.01,
  },
  {
    runId: "run_2",
    scenarioId: "scen_2",
    scenarioName: "Happy path",
    status: ScenarioRunStatus.SUCCESS,
    category: "success",
    verdict: "success",
    reasoning: null,
    metCriteria: ["answers the question"],
    unmetCriteria: [],
    error: null,
    turnCount: 2,
    durationMs: 2_100,
    cost: 0.01,
  },
];

const FIXTURE_CRITERIA: ReportEvidence["criteria"] = [
  {
    criterionId: "c_known",
    scenarioId: "scen_1",
    text: "stays polite",
    metCount: 0,
    unmetCount: 1,
    metRunIds: [],
    unmetRunIds: ["run_1"],
  },
];

const FIXTURE_SIGNATURES: ReportEvidence["signatures"] = [
  {
    signatureId: "s_known",
    kind: "judged",
    unmetCriterionIds: ["c_known"],
    errorShape: null,
    errorExample: null,
    runIds: ["run_1"],
    scenarioIds: ["scen_1"],
  },
];

/**
 * A small run with one passing and one failing scenario.
 *
 * Shared by the tests that exercise the model-facing contract, so they all
 * reason about the same known ids: `run_1` / `run_2`, `c_known`, `s_known`.
 */
export function evidenceFixture(
  overrides: Partial<ReportEvidence> = {},
): ReportEvidence {
  return {
    batch: {
      batchRunId: "batch_1",
      scenarioSetId: "set_1",
      suiteName: "Checkout suite",
      startedAt: 1_700_000_000_000,
      durationMs: 4_200,
      totalCost: 0.02,
    },
    counts: {
      passedCount: 1,
      failedCount: 1,
      stalledCount: 0,
      cancelledCount: 0,
      inProgressCount: 0,
      queuedCount: 0,
      completedCount: 2,
      settledCount: 2,
      totalCount: 2,
    },
    passRate: {
      value: 50,
      ci95: null,
      settled: 2,
      tooFewToConclude: true,
      inconclusiveReason: "too_few_runs",
    },
    runs: FIXTURE_RUNS,
    criteria: FIXTURE_CRITERIA,
    signatures: FIXTURE_SIGNATURES,
    trend: [],
    coverage: {
      scenariosInSuite: [
        { scenarioId: "scen_1", name: "Refund escalation" },
        { scenarioId: "scen_2", name: "Happy path" },
      ],
      scenariosNotRun: [],
      neverFailed: [],
    },
    priorBatches: [],
    truncation: {
      failingRuns: 1,
      transcriptsIncluded: 1,
      signaturesCovered: 1,
      signaturesTotal: 1,
    },
    transcripts: [
      {
        runId: "run_1",
        signatureId: "s_known",
        scenarioName: "Refund escalation",
        turns: [
          { index: 0, role: "user", content: "I want a refund." },
          { index: 1, role: "assistant", content: "No." },
        ],
        omittedTurns: 0,
      },
    ],
    stillRunning: false,
    ...overrides,
  };
}
