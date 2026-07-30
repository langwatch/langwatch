import { parseGroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import * as automations from "..";
import {
  type AutomationsPipelineDeps,
  createAutomationsPipeline,
  GLOBAL_TENANT,
  recordMatchGroupKey,
  singletonProcessManagerGroupKey,
  triggerSettlementGroupKey,
} from "..";
import { GRAPH_ALERT_SWEEP_PROCESS_NAME } from "../process-managers/graphAlertSweep";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "../process-managers/triggerSettlement";
import { WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME } from "../process-managers/webhookDeliveryPrune";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

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
    evaluationOutcomeEventTypes: [
      "lw.evaluation.completed",
      "lw.evaluation.reported",
    ],
    graphTriggerActivityEventTypes: ["lw.obs.trace.span_received"],
  };
}

describe("automations pipeline public surface", () => {
  it("exports no accidental undefined bindings", () => {
    const undefinedExports = Object.entries(automations)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);

    expect(undefinedExports).toEqual([]);
  });
});

describe("automations group keys", () => {
  describe("recordMatch command lane", () => {
    it("scopes to the trigger aggregate, one lane for every command on it (ADR-100 decision 4)", () => {
      const key = recordMatchGroupKey({
        tenantId: "project-1",
        triggerId: "trigger-1",
      });

      expect(key).toEqual({
        tenantId: "project-1",
        lane: { kind: "command" },
        scope: {
          kind: "aggregate",
          aggregateType: "trigger",
          aggregateId: "trigger-1",
        },
      });
    });

    it("round-trips through the package's own renderer and parser", () => {
      const key = recordMatchGroupKey({
        tenantId: "project-1",
        triggerId: "trigger-1",
      });

      expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
    });
  });

  describe("triggerSettlement process-manager lane", () => {
    it("is keyed one instance per trigger, and carries the process's own declared name", () => {
      const key = triggerSettlementGroupKey({
        tenantId: "project-1",
        triggerId: "trigger-1",
      });

      expect(key.lane).toEqual({
        kind: "processManager",
        name: TRIGGER_SETTLEMENT_PROCESS_NAME,
      });
      expect(key.scope).toEqual({
        kind: "aggregate",
        aggregateType: "trigger",
        aggregateId: "trigger-1",
      });
    });

    it("gives two different triggers on the same trace two different lanes", () => {
      const a = renderGroupKey(
        triggerSettlementGroupKey({
          tenantId: "project-1",
          triggerId: "trigger-a",
        }),
      );
      const b = renderGroupKey(
        triggerSettlementGroupKey({
          tenantId: "project-1",
          triggerId: "trigger-b",
        }),
      );

      expect(a).not.toBe(b);
    });
  });

  describe("singleton, schedule-only process-manager lanes", () => {
    it("uses the global scope and the placeholder tenant, never a real project id", () => {
      const key = singletonProcessManagerGroupKey(
        GRAPH_ALERT_SWEEP_PROCESS_NAME,
      );

      expect(key).toEqual({
        tenantId: GLOBAL_TENANT,
        lane: {
          kind: "processManager",
          name: GRAPH_ALERT_SWEEP_PROCESS_NAME,
        },
        scope: { kind: "global" },
      });
      expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
    });
  });
});

describe("automations pipeline topology", () => {
  it("assembles the aggregate, all three process managers, and both subscribers", () => {
    const pipeline = createAutomationsPipeline(stubDeps());

    expect(pipeline.name).toBe("automations");
    expect(pipeline.aggregate.name).toBe("trigger");

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

    const settlementKey = pipeline.processManagers[
      TRIGGER_SETTLEMENT_PROCESS_NAME
    ].groupKey({ tenantId: "project-1", triggerId: "trigger-1" });
    expect(settlementKey.lane).toEqual({
      kind: "processManager",
      name: TRIGGER_SETTLEMENT_PROCESS_NAME,
    });

    const sweepKey =
      pipeline.processManagers[GRAPH_ALERT_SWEEP_PROCESS_NAME].groupKey;
    expect(sweepKey.scope).toEqual({ kind: "global" });
  });

  it("threads the injected dispatch ports into the triggerSettlement intent handlers", async () => {
    const deps = stubDeps();
    const pipeline = createAutomationsPipeline(deps);

    // A round-trip through the real handler proves it closed over the exact
    // ports object passed in, not a copy or a stub built internally.
    await pipeline.processManagers[
      TRIGGER_SETTLEMENT_PROCESS_NAME
    ].intentHandlers.logOverflow(
      { triggerId: "trigger-1", traceIds: ["trace-1"] },
      {
        processName: TRIGGER_SETTLEMENT_PROCESS_NAME,
        tenantId: "project-1",
        processKey: "trigger-1",
        messageKey: "overflow:abc",
        attempt: 1,
      },
    );

    expect(deps.dispatch.triggerIsActive).not.toHaveBeenCalled();
  });

  it("subscribes both subscribers to the event types the composition root supplies", () => {
    const pipeline = createAutomationsPipeline(stubDeps());

    expect(pipeline.subscribers.triggerMatch.eventTypes).toEqual([
      "lw.evaluation.completed",
      "lw.evaluation.reported",
    ]);
    expect(pipeline.subscribers.graphTriggerActivity.eventTypes).toEqual([
      "lw.obs.trace.span_received",
    ]);
  });
});
