import { describe, expect, it } from "vitest";
import { SuiteAnalyticsFoldProjection } from "../suiteAnalytics.foldProjection";
import { SuiteRunStateFoldProjection } from "../suiteRunState.foldProjection";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunStartedEvent,
} from "../../schemas/events";

/**
 * ADR-034 Phase 7 parity contract — slim fold reuses the same per-event
 * semantics as `SuiteRunStateFoldProjection` for the shared fields.
 */

const TENANT = "proj-suite-parity";

function makeStarted(total: number): SuiteRunStartedEvent {
  return {
    type: "lw.suite_run.started",
    id: "evt-s",
    tenantId: TENANT,
    aggregateId: "suite-run-1",
    occurredAt: 1_000,
    data: {
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      suiteId: "suite-1",
      total,
      scenarioIds: [],
      targetIds: [],
    },
  } as unknown as SuiteRunStartedEvent;
}

function makeItemCompleted({
  status,
  verdict,
}: {
  status: string;
  verdict?: string;
}): SuiteRunItemCompletedEvent {
  return {
    type: "lw.suite_run.item_completed",
    id: `evt-ic-${Math.random()}`,
    tenantId: TENANT,
    aggregateId: "suite-run-1",
    occurredAt: 2_000,
    data: {
      batchRunId: "batch-1",
      scenarioRunId: "scn-run-1",
      scenarioId: "scn-1",
      status,
      verdict,
    },
  } as unknown as SuiteRunItemCompletedEvent;
}

describe("suiteAnalytics fold — parity vs suiteRunState fold", () => {
  it("agrees on every shared field after a full lifecycle", () => {
    const slim = new SuiteAnalyticsFoldProjection({
      store: { store: async () => {}, get: async () => null },
    });
    const runFold = new SuiteRunStateFoldProjection({
      store: { store: async () => {}, get: async () => null },
    });

    let slimState = slim.init();
    let runState = runFold.init();
    const started = makeStarted(3);
    const itemA = makeItemCompleted({ status: "SUCCESS", verdict: "success" });
    const itemB = makeItemCompleted({ status: "SUCCESS", verdict: "success" });
    const itemC = makeItemCompleted({ status: "FAILURE", verdict: "failure" });

    slimState = slim.handleSuiteRunStarted(started, slimState);
    runState = runFold.handleSuiteRunStarted(started, runState);
    slimState = slim.handleSuiteRunItemCompleted(itemA, slimState);
    runState = runFold.handleSuiteRunItemCompleted(itemA, runState);
    slimState = slim.handleSuiteRunItemCompleted(itemB, slimState);
    runState = runFold.handleSuiteRunItemCompleted(itemB, runState);
    slimState = slim.handleSuiteRunItemCompleted(itemC, slimState);
    runState = runFold.handleSuiteRunItemCompleted(itemC, runState);

    expect(slimState.batchRunId).toBe(runState.BatchRunId);
    expect(slimState.scenarioSetId).toBe(runState.ScenarioSetId);
    expect(slimState.suiteId).toBe(runState.SuiteId);
    expect(slimState.total).toBe(runState.Total);
    expect(slimState.progress).toBe(runState.Progress);
    expect(slimState.completedCount).toBe(runState.CompletedCount);
    expect(slimState.failedCount).toBe(runState.FailedCount);
    expect(slimState.status).toBe(runState.Status);
    expect(slimState.passRateBps).toBe(runState.PassRateBps);
  });
});
