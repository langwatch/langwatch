import { describe, expect, it } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { buildEvidence } from "../../evidence/evidence-builder";
import type { QuestionTier, ReportEvidence } from "../../report.types";
import { QUESTION_REGISTRY } from "../question-registry";

/**
 * The declared list of questions a run report answers.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const BATCH = "batch_current";
const PRIOR_BATCH = "batch_prev";

function makeRun({
  runId,
  scenarioId = "scenario_a",
  status,
  met = [],
  unmet = [],
  error,
  batchRunId = BATCH,
}: {
  runId: string;
  scenarioId?: string;
  status: ScenarioRunStatus;
  met?: string[];
  unmet?: string[];
  error?: string;
  batchRunId?: string;
}): ScenarioRunData {
  return {
    scenarioId,
    batchRunId,
    scenarioRunId: runId,
    name: `Scenario ${scenarioId}`,
    description: null,
    metadata: null,
    status,
    results: {
      verdict: unmet.length > 0 ? Verdict.FAILURE : Verdict.SUCCESS,
      metCriteria: met,
      unmetCriteria: unmet,
      ...(error === undefined ? {} : { error }),
    },
    messages: [],
    timestamp: 1_700_000_000_000,
    durationInMs: 90_000,
    totalCost: 0.12,
  };
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

const failingRuns = [
  makeRun({
    runId: "run_1",
    status: ScenarioRunStatus.FAILED,
    unmet: ["offers a refund"],
    met: ["stays polite"],
  }),
  makeRun({
    runId: "run_2",
    scenarioId: "scenario_b",
    status: ScenarioRunStatus.ERROR,
    error: "Connection refused by upstream",
  }),
  makeRun({
    runId: "run_3",
    status: ScenarioRunStatus.SUCCESS,
    met: ["stays polite", "offers a refund"],
  }),
  makeRun({
    runId: "run_4",
    scenarioId: "scenario_c",
    status: ScenarioRunStatus.STALLED,
  }),
];

const priorRuns = [
  makeRun({
    runId: "prior_1",
    status: ScenarioRunStatus.SUCCESS,
    batchRunId: PRIOR_BATCH,
    met: ["stays polite", "offers a refund"],
  }),
];

/** Failures, an error, a stall, prior history — everything switched on. */
const richEvidence = build({
  runs: failingRuns,
  priorRuns,
  priorBatchOrder: [PRIOR_BATCH],
});

/** No runs, no criteria, no prior batches. */
const emptyEvidence = build({ runs: [] });

/** Failures but no history to compare them against. */
const firstRunEvidence = build({ runs: failingRuns });

/** History, but nothing failed. */
const cleanRunEvidence = build({
  runs: [
    makeRun({
      runId: "run_1",
      status: ScenarioRunStatus.SUCCESS,
      met: ["stays polite"],
    }),
  ],
  priorRuns,
  priorBatchOrder: [PRIOR_BATCH],
});

function descriptorFor(id: string) {
  const descriptor = QUESTION_REGISTRY.find((entry) => entry.id === id);
  if (!descriptor) throw new Error(`No question descriptor for ${id}`);
  return descriptor;
}

describe("QUESTION_REGISTRY shape", () => {
  it("gives every question a unique id", () => {
    const ids = QUESTION_REGISTRY.map((descriptor) => descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(
    QUESTION_REGISTRY.map((descriptor) => descriptor.id),
  )("gives %s a question and an intent a reader can read", (id) => {
    const descriptor = descriptorFor(id);
    expect(descriptor.question.trim().length).toBeGreaterThan(0);
    expect(descriptor.intent.trim().length).toBeGreaterThan(0);
  });

  /** @scenario Questions are grouped into what happened, what is true now, and what to do next */
  it("represents all three tiers", () => {
    const tiers = new Set(
      QUESTION_REGISTRY.map((descriptor) => descriptor.tier),
    );
    expect([...tiers].sort()).toEqual(["future", "past", "present"]);
  });

  /** @scenario Questions are grouped into what happened, what is true now, and what to do next */
  it.each([
    "past",
    "present",
    "future",
  ] as QuestionTier[])("asks at least one %s question", (tier) => {
    expect(
      QUESTION_REGISTRY.filter((descriptor) => descriptor.tier === tier),
    ).not.toHaveLength(0);
  });
});

describe("QUESTION_REGISTRY applicability when there is no history", () => {
  const trendQuestionIds = ["past.regressions", "past.fixed"];

  /** @scenario The first run of a suite reports no trend */
  it.each(trendQuestionIds)("marks %s inapplicable", (id) => {
    expect(descriptorFor(id).applicability(firstRunEvidence).applicable).toBe(
      false,
    );
  });

  /** @scenario The first run of a suite reports no trend */
  it.each(trendQuestionIds)("says why %s cannot be answered", (id) => {
    const applicability = descriptorFor(id).applicability(firstRunEvidence);
    expect(applicability.applicable ? "" : applicability.reason).toContain(
      "No earlier run",
    );
  });

  it.each(
    trendQuestionIds,
  )("marks %s applicable once a run precedes it", (id) => {
    expect(descriptorFor(id).applicability(richEvidence).applicable).toBe(true);
  });
});

describe("QUESTION_REGISTRY applicability when nothing failed", () => {
  const failureQuestionIds = [
    "present.clusters",
    "present.severity",
    "future.scenario",
    "future.prompt",
    "future.guardrail",
  ];

  it.each(failureQuestionIds)("marks %s inapplicable", (id) => {
    expect(descriptorFor(id).applicability(cleanRunEvidence).applicable).toBe(
      false,
    );
  });

  it.each(failureQuestionIds)("says why %s cannot be answered", (id) => {
    const applicability = descriptorFor(id).applicability(cleanRunEvidence);
    expect(
      applicability.applicable ? "" : applicability.reason,
    ).not.toHaveLength(0);
  });

  it.each(
    failureQuestionIds,
  )("marks %s applicable once something fails", (id) => {
    expect(descriptorFor(id).applicability(richEvidence).applicable).toBe(true);
  });
});

describe("QUESTION_REGISTRY computed blocks on a rich run", () => {
  /** @scenario Every question the report asks appears in it */
  it.each(
    QUESTION_REGISTRY.map((descriptor) => descriptor.id),
  )("computes %s without throwing", (id) => {
    expect(() => descriptorFor(id).computed(richEvidence)).not.toThrow();
  });

  it.each(
    QUESTION_REGISTRY.map((descriptor) => descriptor.id),
  )("returns renderable blocks for %s", (id) => {
    for (const block of descriptorFor(id).computed(richEvidence)) {
      expect(typeof block.kind).toBe("string");
    }
  });
});

describe("QUESTION_REGISTRY computed blocks on an empty run", () => {
  /** @scenario Every question the report asks appears in it */
  it.each(
    QUESTION_REGISTRY.map((descriptor) => descriptor.id),
  )("computes %s without throwing", (id) => {
    expect(() => descriptorFor(id).computed(emptyEvidence)).not.toThrow();
  });

  /** @scenario A report still downloads when no model is configured */
  it("still produces the outcome figures", () => {
    expect(descriptorFor("past.outcome").computed(emptyEvidence)).not.toEqual(
      [],
    );
  });
});

describe("QUESTION_REGISTRY computed blocks when a run is unfinished", () => {
  const unfinished = build({
    runs: [
      ...failingRuns,
      makeRun({
        runId: "run_5",
        scenarioId: "scenario_d",
        status: ScenarioRunStatus.IN_PROGRESS,
      }),
    ],
  });

  /** @scenario A run still in progress reports only what has finished */
  it("leads the outcome section with a note about what is missing", () => {
    const [first] = descriptorFor("past.outcome").computed(unfinished);
    expect(first).toMatchObject({ kind: "note", tone: "warn" });
  });
});
