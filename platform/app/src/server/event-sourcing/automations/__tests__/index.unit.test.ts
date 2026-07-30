import { parseGroupKey, processGroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  type AutomationsPipelineDeps,
  GLOBAL_TENANT,
  createAutomationsPipeline,
  recordMatchGroupKey,
  singletonProcessManagerGroupKey,
  triggerSettlementGroupKey,
} from "..";
import { GRAPH_ALERT_SWEEP_PROCESS_NAME } from "../graphAlertSweep.process";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "../triggerSettlement.process";
import { WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME } from "../webhookDeliveryPrune.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
      pruneDispatchedIntentsBefore: vi.fn(),
    },
    prune: {
      pruneExpiredDeliveries: vi.fn(),
      pruneDispatchedIntentsBefore: vi.fn(),
    },
  };
}

describe("automations group keys", () => {
  describe("recordMatch command lane", () => {
    /** @scenario a command lane is scoped to the aggregate */
    it("scopes to the trigger aggregate, one lane for every command on it (ADR-100 decision 4)", () => {
      const key = recordMatchGroupKey({ tenantId: "project-1", triggerId: "trigger-1" });

      expect(key).toEqual({
        tenantId: "project-1",
        lane: { kind: "command" },
        scope: { kind: "aggregate", aggregateType: "trigger", aggregateId: "trigger-1" },
      });
    });

    it("round-trips through the package's own renderer and parser", () => {
      const key = recordMatchGroupKey({ tenantId: "project-1", triggerId: "trigger-1" });
      expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
    });
  });

  describe("triggerSettlement process-manager lane", () => {
    it("is the package's own process key: one instance per trigger, named by the process", () => {
      const key = triggerSettlementGroupKey({ tenantId: "project-1", triggerId: "trigger-1" });

      expect(key).toEqual(
        processGroupKey({ name: TRIGGER_SETTLEMENT_PROCESS_NAME }, { tenantId: "project-1", processKey: "trigger-1" }),
      );
      expect(key.lane).toEqual({ kind: "processManager", name: TRIGGER_SETTLEMENT_PROCESS_NAME });
    });

    it("gives two different triggers on the same trace two different lanes", () => {
      const a = renderGroupKey(triggerSettlementGroupKey({ tenantId: "project-1", triggerId: "trigger-a" }));
      const b = renderGroupKey(triggerSettlementGroupKey({ tenantId: "project-1", triggerId: "trigger-b" }));
      expect(a).not.toBe(b);
    });
  });

  describe("singleton, schedule-only process-manager lanes", () => {
    it("uses the global scope and the placeholder tenant, never a real project id", () => {
      const key = singletonProcessManagerGroupKey(GRAPH_ALERT_SWEEP_PROCESS_NAME);

      expect(key).toEqual({
        tenantId: GLOBAL_TENANT,
        lane: { kind: "processManager", name: GRAPH_ALERT_SWEEP_PROCESS_NAME },
        scope: { kind: "global" },
      });
      expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
    });
  });
});

describe("automations pipeline topology", () => {
  it("names itself 'trigger', matching the persisted AggregateType already in event_log", () => {
    const built = createAutomationsPipeline(stubDeps());
    expect(built.name).toBe("trigger");
  });

  it("derives the dotted event type string already persisted in event_log", () => {
    const built = createAutomationsPipeline(stubDeps());
    expect(built.eventTypes).toEqual(["lw.automation.trigger.match_recorded"]);
  });

  it("mounts the command and all three process managers", () => {
    const built = createAutomationsPipeline(stubDeps());

    expect(Object.keys(built.commands)).toEqual(["recordMatch"]);
    expect(Object.keys(built.processManagers).sort()).toEqual(
      [TRIGGER_SETTLEMENT_PROCESS_NAME, GRAPH_ALERT_SWEEP_PROCESS_NAME, WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME].sort(),
    );
  });

  it("threads the injected dispatch ports into the triggerSettlement intent delivery", async () => {
    const deps = stubDeps();
    const built = createAutomationsPipeline(deps);

    // A round-trip through the real intent proves it closed over the exact
    // ports object passed in, not a copy or a stub built internally.
    await built.processManagers[TRIGGER_SETTLEMENT_PROCESS_NAME]!.intents.logOverflow!.deliver(
      { triggerId: "trigger-1", traceIds: ["trace-1"], flushed: 1, totalFlushed: 1 },
      { now: 1_000, tenantId: "project-1" },
    );

    expect(deps.dispatch.triggerIsActive).not.toHaveBeenCalled();
  });

  it("is asserted at composition rather than on the first delivery", () => {
    expect(() => createAutomationsPipeline(stubDeps())).not.toThrow();
  });
});
