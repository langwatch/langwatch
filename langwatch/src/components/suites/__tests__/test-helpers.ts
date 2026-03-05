/**
 * Shared test factories for suites test files.
 *
 * Centralizes makeScenarioRunData, makeBatchRun, and makeSummary
 * to avoid duplication across unit and integration tests.
 */
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { BatchRun, BatchRunSummary } from "../run-history-transforms";

export function makeScenarioRunData(
  overrides: Partial<ScenarioRunData> = {},
): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Angry refund request",
    description: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      reasoning: "All criteria met",
      metCriteria: ["criteria_1"],
      unmetCriteria: [],
    },
    messages: [],
    timestamp: Date.now(),
    durationInMs: 2300,
    ...overrides,
  };
}

export function makeBatchRun(overrides: Partial<BatchRun> = {}): BatchRun {
  const batchRunId = overrides.batchRunId ?? "batch_1";
  return {
    groupKey: batchRunId,
    groupLabel: batchRunId,
    groupType: "none",
    batchRunId,
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    scenarioRuns: [
      makeScenarioRunData(),
      makeScenarioRunData({
        scenarioRunId: "run_2",
        scenarioId: "scen_2",
        name: "Policy violation",
      }),
    ],
    ...overrides,
  };
}

export function makeSummary(
  overrides: Partial<BatchRunSummary> = {},
): BatchRunSummary {
  return {
    passRate: 100,
    passedCount: 2,
    failedCount: 0,
    stalledCount: 0,
    cancelledCount: 0,
    totalCount: 2,
    inProgressCount: 0,
    ...overrides,
  };
}
