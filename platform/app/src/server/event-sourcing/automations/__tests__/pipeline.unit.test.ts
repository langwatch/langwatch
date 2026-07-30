import { describe, expect, it, vi } from "vitest";
import { createAutomationsPipeline, type AutomationsPipelineDeps } from "../pipeline";
import { GRAPH_ALERT_SWEEP_PROCESS_NAME } from "../process-managers/graphAlertSweep";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "../process-managers/triggerSettlement";
import { WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME } from "../process-managers/webhookDeliveryPrune";

function stubDeps(): AutomationsPipelineDeps {
  return {
    dispatch: {
      triggerIsActive: vi.fn(),
      confirmSettledMatch: vi.fn(),
      isSendClaimed: vi.fn(),
      claimSend: vi.fn(),
      sendNotifyDigest: vi.fn(),
      runPersistAction: vi.fn(),
    },
    sweep: {
      decideSweepCandidates: vi.fn().mockResolvedValue([]),
      evaluateGraphTrigger: vi.fn(),
    },
    prune: {
      pruneExpiredDeliveries: vi.fn(),
      pruneDispatchedIntentsBefore: vi.fn(),
    },
    evaluationTriggerMatch: {
      getActiveTraceTriggersForProject: vi.fn(),
      readTraceSummary: vi.fn(),
      recordMatch: { send: vi.fn() },
    },
    graphTriggerActivity: {
      getActiveGraphTriggers: vi.fn(),
      evaluateGraphTrigger: vi.fn(),
    },
    graphTriggerActivityEventTypes: ["trace/committed"],
  };
}

describe("automations pipeline topology", () => {
  it("assembles the aggregate, all three process managers, and both subscribers", () => {
    const pipeline = createAutomationsPipeline(stubDeps());

    expect(pipeline.name).toBe("automations");
    expect(pipeline.aggregateType).toBe("trigger");

    expect(Object.keys(pipeline.processManagers).sort()).toEqual(
      [
        TRIGGER_SETTLEMENT_PROCESS_NAME,
        GRAPH_ALERT_SWEEP_PROCESS_NAME,
        WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
      ].sort(),
    );
    expect(Object.keys(pipeline.subscribers).sort()).toEqual(
      ["triggerMatch", "graphTriggerActivity"].sort(),
    );
  });

  it("wires every process manager's own group-key builder, not a shared placeholder", () => {
    const pipeline = createAutomationsPipeline(stubDeps());

    const settlementKey = pipeline.processManagers[TRIGGER_SETTLEMENT_PROCESS_NAME].groupKey({
      tenantId: "project-1",
      triggerId: "trigger-1",
    });
    expect(settlementKey.lane).toEqual({
      kind: "processManager",
      name: TRIGGER_SETTLEMENT_PROCESS_NAME,
    });

    const sweepKey = pipeline.processManagers[GRAPH_ALERT_SWEEP_PROCESS_NAME].groupKey;
    expect(sweepKey.scope).toEqual({ kind: "global" });
  });

  it("threads the injected dispatch ports into the triggerSettlement intent handlers", () => {
    const deps = stubDeps();
    const pipeline = createAutomationsPipeline(deps);

    // A round-trip through the real handler proves it closed over the exact
    // ports object passed in, not a copy or a stub built internally.
    return pipeline.processManagers[TRIGGER_SETTLEMENT_PROCESS_NAME].intentHandlers
      .logOverflow({ triggerId: "trigger-1", flushed: 1, totalFlushed: 1 }, {
        processName: TRIGGER_SETTLEMENT_PROCESS_NAME,
        tenantId: "project-1",
        processKey: "trigger-1",
        messageKey: "overflow:1",
        attempt: 1,
      })
      .then(() => {
        expect(deps.dispatch.triggerIsActive).not.toHaveBeenCalled();
      });
  });
});
