import { parseGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "../process-managers/triggerSettlement";
import { GRAPH_ALERT_SWEEP_PROCESS_NAME } from "../process-managers/graphAlertSweep";
import {
  GLOBAL_TENANT,
  recordMatchGroupKey,
  renderRecordMatchGroupKey,
  renderSingletonProcessManagerGroupKey,
  renderTriggerSettlementGroupKey,
  singletonProcessManagerGroupKey,
  triggerSettlementGroupKey,
} from "../groupKeys";

describe("automations group keys", () => {
  describe("recordMatch command lane", () => {
    it("scopes to the trigger aggregate, one lane for every command on it (ADR-100 decision 4)", () => {
      const key = recordMatchGroupKey({ tenantId: "project-1", triggerId: "trigger-1" });

      expect(key).toEqual({
        tenantId: "project-1",
        lane: { kind: "command" },
        scope: { kind: "aggregate", aggregateType: "trigger", aggregateId: "trigger-1" },
      });
    });

    it("renders through the package's own renderer and round-trips via parseGroupKey", () => {
      const rendered = renderRecordMatchGroupKey({ tenantId: "project-1", triggerId: "trigger-1" });

      expect(rendered).toBe(renderRecordMatchGroupKey({ tenantId: "project-1", triggerId: "trigger-1" }));
      expect(parseGroupKey(rendered)).toEqual(
        recordMatchGroupKey({ tenantId: "project-1", triggerId: "trigger-1" }),
      );
    });
  });

  describe("triggerSettlement process-manager lane", () => {
    it("is keyed one instance per trigger, and carries the process's own declared name", () => {
      const key = triggerSettlementGroupKey({ tenantId: "project-1", triggerId: "trigger-1" });

      expect(key.lane).toEqual({ kind: "processManager", name: TRIGGER_SETTLEMENT_PROCESS_NAME });
      expect(key.scope).toEqual({
        kind: "aggregate",
        aggregateType: "trigger",
        aggregateId: "trigger-1",
      });
    });

    it("gives two different triggers on the same trace two different lanes", () => {
      const a = renderTriggerSettlementGroupKey({ tenantId: "project-1", triggerId: "trigger-a" });
      const b = renderTriggerSettlementGroupKey({ tenantId: "project-1", triggerId: "trigger-b" });

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
    });

    it("renders and round-trips through the package's parser", () => {
      const rendered = renderSingletonProcessManagerGroupKey(GRAPH_ALERT_SWEEP_PROCESS_NAME);

      expect(parseGroupKey(rendered)).toEqual(
        singletonProcessManagerGroupKey(GRAPH_ALERT_SWEEP_PROCESS_NAME),
      );
    });
  });
});
