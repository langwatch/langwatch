import { describe, expect, it } from "vitest";
import { graphTriggerActivityGroupKey } from "../graphTriggerActivity.subscriber";

/**
 * The sweep lane must be tenant-keyed and aggregate-independent: all of a
 * tenant's sweep jobs serialize in one group, so the 5s dedup's staging
 * bound is matched by a concurrency bound of 1. A key that varies by trace
 * or event id regresses to the 2026-07-31 parallel sweep storm.
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
