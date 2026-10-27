import { graphTriggerActivityGroupKey } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

/**
 * The sweep lane must be tenant-keyed and aggregate-independent: a
 * tenant's jobs serialize into one group (concurrency 1) matching the 5s
 * dedup bound -- keying by trace/event id regresses the 2026-07-31 storm.
 */
describe("graphTriggerActivityGroupKey", () => {
  describe("when events for the same tenant come from different traces", () => {
    it("routes them to the same lane", () => {
      const a = { tenantId: "project_x", aggregateId: "trace_1" } as never;
      const b = { tenantId: "project_x", aggregateId: "trace_2" } as never;
      expect(graphTriggerActivityGroupKey(a)).toBe(graphTriggerActivityGroupKey(b));
    });
  });

  describe("when events belong to different tenants", () => {
    it("routes them to different lanes", () => {
      expect(graphTriggerActivityGroupKey({ tenantId: "project_x" })).not.toBe(
        graphTriggerActivityGroupKey({ tenantId: "project_y" }),
      );
    });
  });

  it("matches the dedup id family so lane and dedup describe the same unit", () => {
    expect(graphTriggerActivityGroupKey({ tenantId: "project_x" })).toBe(
      "graph-trigger-activity:project_x",
    );
  });

  describe("when the trace and evaluation pipelines wake the sweep for one tenant", () => {
    it("both land in the same final lane — the group id carries no pipeline segment", () => {
      // A sweep evaluates ALL of the tenant's graph triggers regardless of
      // which event kind (span vs evaluation) woke it, so the two pipelines'
      // registrations must converge on one serialized lane per tenant.
      const fromTrace = {
        tenantId: "project_x",
        aggregateId: "trace_1",
        type: "lw.obs.trace.span_received",
      } as never;
      const fromEvaluation = {
        tenantId: "project_x",
        aggregateId: "eval_1",
        type: "lw.obs.evaluation.completed",
      } as never;
      expect(graphTriggerActivityGroupKey(fromTrace)).toBe(
        graphTriggerActivityGroupKey(fromEvaluation),
      );
    });
  });
});
