import { describe, expect, it } from "vitest";
import {
  countRunOutcomes,
  passRateFrom,
} from "~/server/scenarios/run-outcome-summary";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ReportEvidence } from "../../report.types";
import { buildEvidence } from "../evidence-builder";
import { criterionIdFor } from "../fingerprint";

/**
 * The fact pack the rest of the report is built from.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const BATCH = "batch_current";
const PRIOR_BATCH = "batch_prev";
const REFUND = "offers a refund";
const POLITE = "stays polite";

function makeRun(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scenario_a",
    batchRunId: BATCH,
    scenarioRunId: "run_1",
    name: "Angry refund request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [],
    timestamp: 1_700_000_000_000,
    durationInMs: 1_000,
    ...overrides,
  };
}

function judgedRun({
  runId,
  scenarioId = "scenario_a",
  met = [],
  unmet = [],
  batchRunId = BATCH,
}: {
  runId: string;
  scenarioId?: string;
  met?: string[];
  unmet?: string[];
  batchRunId?: string;
}): ScenarioRunData {
  return makeRun({
    scenarioRunId: runId,
    scenarioId,
    batchRunId,
    status:
      unmet.length > 0 ? ScenarioRunStatus.FAILED : ScenarioRunStatus.SUCCESS,
    results: {
      verdict: unmet.length > 0 ? Verdict.FAILURE : Verdict.SUCCESS,
      metCriteria: met,
      unmetCriteria: unmet,
    },
  });
}

function build({
  runs,
  priorRuns = [],
  priorBatchOrder = [],
}: {
  runs: ScenarioRunData[];
  priorRuns?: ScenarioRunData[];
  priorBatchOrder?: string[];
}): ReportEvidence {
  return buildEvidence({
    runs,
    priorRuns,
    batchRunId: BATCH,
    scenarioSetId: "set_1",
    suiteName: "Refunds",
    priorBatchOrder,
  });
}

const erroredRun = makeRun({
  scenarioRunId: "run_3",
  scenarioId: "scenario_b",
  name: "Escalation path",
  status: ScenarioRunStatus.ERROR,
  results: {
    verdict: Verdict.INCONCLUSIVE,
    metCriteria: [],
    unmetCriteria: [],
    error: "Connection refused by upstream",
  },
});

describe("buildEvidence() counting", () => {
  const runs = [
    judgedRun({ runId: "run_1", unmet: [REFUND] }),
    judgedRun({ runId: "run_2", unmet: [REFUND] }),
    erroredRun,
    judgedRun({ runId: "run_4", met: [REFUND] }),
  ];

  /** @scenario The report never disagrees with the screen */
  it("counts outcomes with the same function the screen uses", () => {
    expect(build({ runs }).counts).toEqual(
      countRunOutcomes({ statuses: runs.map((run) => run.status) }),
    );
  });

  /** @scenario The report never disagrees with the screen */
  it("derives the pass rate from the settled runs", () => {
    expect(build({ runs }).passRate.settled).toBe(4);
    expect(build({ runs }).passRate.value).toBeCloseTo(25);
  });

  it("tallies a criterion across repeats of the same scenario", () => {
    const fact = build({ runs }).criteria.find(
      (criterion) => criterion.text === REFUND,
    );
    expect(fact).toMatchObject({
      metCount: 1,
      unmetCount: 2,
      metRunIds: ["run_4"],
      unmetRunIds: ["run_1", "run_2"],
    });
  });
});

describe("buildEvidence() failure grouping", () => {
  const runs = [
    judgedRun({ runId: "run_1", unmet: [REFUND] }),
    judgedRun({ runId: "run_2", unmet: [REFUND] }),
    erroredRun,
    judgedRun({ runId: "run_4", met: [REFUND] }),
  ];
  const { signatures } = build({ runs });

  /** @scenario Failures are grouped by what went wrong */
  it("puts two runs failing the same criterion in one signature", () => {
    const judged = signatures.filter((it) => it.kind === "judged");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.runIds).toEqual(["run_1", "run_2"]);
  });

  /** @scenario Infrastructure errors are separated from judged failures */
  it("keeps the errored run out of the judged signature", () => {
    expect(signatures.map((it) => it.kind).sort()).toEqual([
      "errored",
      "judged",
    ]);
  });

  /** @scenario Infrastructure errors are separated from judged failures */
  it("groups the errored run by the shape of its error", () => {
    const errored = signatures.find((it) => it.kind === "errored");
    expect(errored?.errorShape).toBe("Connection refused by upstream");
    expect(errored?.runIds).toEqual(["run_3"]);
  });
  /** @scenario A group cannot claim a scenario that did not fail */
  it("never lists a passing run under a failure group", () => {
    expect(signatures.flatMap((it) => it.runIds)).not.toContain("run_4");
  });
});

describe("buildEvidence() error reporting", () => {
  /**
   * The fingerprint replaces every quoted value, which is right for grouping
   * and leaves a serialised error as nothing but its own punctuation. Runs
   * record `{"name","message","stack"}`, so the readable half is the message —
   * the stack is longer than the rest of the group put together.
   *
   * @scenario Infrastructure errors are separated from judged failures
   */
  it("keeps one readable error beside the fingerprint", () => {
    const [signature] = buildEvidence({
      runs: [
        makeRun({
          scenarioRunId: "run_json",
          status: ScenarioRunStatus.ERROR,
          results: {
            verdict: Verdict.INCONCLUSIVE,
            metCriteria: [],
            unmetCriteria: [],
            error: JSON.stringify({
              name: "Error",
              message: "AI_APICallError: content flagged",
              stack: "Error: AI_APICallError\n    at somewhere",
            }),
          },
        }),
      ],
      priorRuns: [],
      priorBatchOrder: [],
      batchRunId: BATCH,
      scenarioSetId: "set_1",
      suiteName: null,
    }).signatures;

    expect(signature?.errorShape).not.toContain("content flagged");
    expect(signature?.errorExample).toBe("AI_APICallError: content flagged");
  });

  /** @scenario Infrastructure errors are separated from judged failures */
  it("uses an error that is not a serialised Error as it stands", () => {
    const [signature] = buildEvidence({
      runs: [
        makeRun({
          scenarioRunId: "run_plain",
          status: ScenarioRunStatus.ERROR,
          results: {
            verdict: Verdict.INCONCLUSIVE,
            metCriteria: [],
            unmetCriteria: [],
            error: "Connection refused by upstream",
          },
        }),
      ],
      priorRuns: [],
      priorBatchOrder: [],
      batchRunId: BATCH,
      scenarioSetId: "set_1",
      suiteName: null,
    }).signatures;

    expect(signature?.errorExample).toBe("Connection refused by upstream");
  });
});

describe("buildEvidence() failure grouping across scenarios", () => {
  const runs = [
    judgedRun({ runId: "run_1", scenarioId: "scenario_a", unmet: [REFUND] }),
    judgedRun({ runId: "run_2", scenarioId: "scenario_b", unmet: [REFUND] }),
  ];

  // Criterion identity is scoped to its scenario so a trend can follow one
  // scenario's criterion over time. A failure GROUP is a different question —
  // it is about the mechanism — so it is keyed on the criterion text. One
  // criterion failing in three scenarios is one problem with the agent, and
  // splitting it per scenario hides the pattern most worth seeing.
  /** @scenario Failures are grouped by what went wrong */
  it("merges the same criterion text across scenarios into one group", () => {
    expect(build({ runs }).signatures).toHaveLength(1);
  });

  it("records every scenario the group spans", () => {
    const [signature] = build({ runs }).signatures;

    expect(signature?.scenarioIds.sort()).toEqual(["scenario_a", "scenario_b"]);
    expect(signature?.runIds.sort()).toEqual(["run_1", "run_2"]);
  });

  // The group spans scenarios, but a claim still has to be able to cite the
  // exact criterion in the exact scenario, so both ids survive the merge.
  it("keeps each scenario's own criterion id for citation", () => {
    const [signature] = build({ runs }).signatures;

    expect(signature?.unmetCriterionIds).toHaveLength(2);
  });
});

describe("buildEvidence() when scenarios have not finished", () => {
  /** @scenario A run still in progress reports only what has finished */
  it.each([
    ScenarioRunStatus.IN_PROGRESS,
    ScenarioRunStatus.QUEUED,
  ])("flags the run as still running when one is %s", (status) => {
    const runs = [
      judgedRun({ runId: "run_1", met: [REFUND] }),
      makeRun({ scenarioRunId: "run_2", status }),
    ];
    expect(build({ runs }).stillRunning).toBe(true);
  });

  it("does not flag a run where everything reached a terminal state", () => {
    const runs = [judgedRun({ runId: "run_1", met: [REFUND] }), erroredRun];
    expect(build({ runs }).stillRunning).toBe(false);
  });

  it("leaves unfinished runs out of the failure signatures", () => {
    const runs = [
      makeRun({ scenarioRunId: "run_2", status: ScenarioRunStatus.QUEUED }),
      makeRun({
        scenarioRunId: "run_3",
        status: ScenarioRunStatus.IN_PROGRESS,
      }),
    ];
    expect(build({ runs }).signatures).toEqual([]);
  });
});

describe("buildEvidence() against previous runs", () => {
  const runs = [judgedRun({ runId: "run_1", met: [POLITE, REFUND] })];
  const priorRuns = [
    judgedRun({
      runId: "prior_1",
      batchRunId: PRIOR_BATCH,
      met: [POLITE, REFUND],
    }),
    judgedRun({
      runId: "prior_2",
      batchRunId: PRIOR_BATCH,
      met: [POLITE],
      unmet: [REFUND],
    }),
  ];
  const evidence = build({
    runs,
    priorRuns,
    priorBatchOrder: [PRIOR_BATCH],
  });

  function trendFor(text: string) {
    return evidence.trend.find((fact) => fact.text === text);
  }

  it("computes a prior batch pass rate with the canonical function", () => {
    const counts = countRunOutcomes({
      statuses: priorRuns.map((run) => run.status),
    });
    expect(evidence.priorBatches).toEqual([
      {
        batchRunId: PRIOR_BATCH,
        startedAt: 1_700_000_000_000,
        passRate: passRateFrom({ counts }),
        settled: counts.settledCount,
      },
    ]);
  });

  it("counts a criterion unmet in any run of a batch as unmet for that batch", () => {
    expect(trendFor(REFUND)?.history).toEqual([
      { batchRunId: PRIOR_BATCH, outcome: "unmet" },
      { batchRunId: BATCH, outcome: "met" },
    ]);
  });

  /** @scenario A criterion that used to fail and now passes is called fixed */
  it("classifies that criterion as fixed", () => {
    expect(trendFor(REFUND)?.classification).toBe("fixed");
  });

  /** @scenario The report says what held up */
  it("names a criterion that has never failed as holding", () => {
    expect(evidence.coverage.neverFailed).toEqual([
      {
        criterionId: criterionIdFor({
          scenarioId: "scenario_a",
          text: POLITE,
        }),
        text: POLITE,
        batches: 2,
      },
    ]);
  });

  /** @scenario The report says what held up */
  it("excludes a criterion that failed in a previous run", () => {
    expect(evidence.coverage.neverFailed.map((it) => it.text)).not.toContain(
      REFUND,
    );
  });
});

describe("buildEvidence() with nothing to report", () => {
  const evidence = build({ runs: [] });

  it("produces empty facts rather than throwing", () => {
    expect(evidence.runs).toEqual([]);
    expect(evidence.criteria).toEqual([]);
    expect(evidence.signatures).toEqual([]);
    expect(evidence.trend).toEqual([]);
  });

  it("reports no pass rate at all", () => {
    expect(evidence.passRate.value).toBeNull();
    expect(evidence.passRate.tooFewToConclude).toBe(true);
  });

  it("reports no total cost when no run carried one", () => {
    expect(evidence.batch.totalCost).toBeNull();
  });
});
