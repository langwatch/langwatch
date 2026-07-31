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
      expect(graphTriggerActivityGroupKey(a)).toBe(
        graphTriggerActivityGroupKey(b),
      );
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
});
