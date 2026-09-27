import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type JobLane, routeJob, sealJobLane } from "../jobLane.ts";

const payloadSchema = z.object({ tenantId: z.string(), id: z.string(), oversized: z.boolean() });
type Payload = z.infer<typeof payloadSchema>;

function laneWith(overrides: Partial<JobLane<Payload>> = {}): JobLane<Payload> {
  return {
    parse: (value) => payloadSchema.parse(value),
    process: vi.fn().mockResolvedValue(undefined),
    getTenantId: (payload) => payload.tenantId,
    groupKeyFn: (payload) => `${payload.tenantId}/job/test/${payload.id}`,
    scoreFn: () => 10,
    ...overrides,
  };
}

const payload: Payload = { tenantId: "tenant-a", id: "a", oversized: false };
const route = (lane: JobLane<Payload>, value: Payload = payload) =>
  routeJob({
    lane,
    payload: value,
    deduplication: lane.deduplication,
    namespaceDedupId: (id) => `ns/${id}`,
  });

describe("routing a job at send", () => {
  describe("given a lane with no coalescing bound", () => {
    it("folds the job alone", () => {
      expect(route(laneWith()).coalesceMaxBatch).toBe(1);
    });
  });

  describe("given a lane whose bound is resolved per payload", () => {
    it("answers what the resolver says about this job", () => {
      const lane = laneWith({ coalesceMaxBatch: (value) => (value.oversized ? 1 : 64) });

      expect(route(lane, { ...payload, oversized: true }).coalesceMaxBatch).toBe(1);
      expect(route(lane).coalesceMaxBatch).toBe(64);
    });
  });

  describe("given a deduplicated lane", () => {
    it("carries the namespaced dedup id beside the group and score", () => {
      const lane = laneWith({ deduplication: { makeId: (value) => value.id } });

      expect(route(lane)).toMatchObject({
        groupKey: "tenant-a/job/test/a",
        score: 10,
        dedupId: "ns/a",
      });
    });
  });

  describe("given a span attribute reader that throws", () => {
    it("routes the job without the attributes", () => {
      const lane = laneWith({
        spanAttributes: () => {
          throw new Error("unreadable");
        },
      });

      expect(route(lane).spanAttributes).toBeUndefined();
    });
  });
});

describe("reading a dequeued batch", () => {
  describe("given one payload that fails its lane's schema", () => {
    it("refuses the batch before the handler runs", () => {
      const processBatch = vi.fn().mockResolvedValue(undefined);
      const entry = sealJobLane(laneWith({ processBatch }), (id) => id);

      expect(() => entry.readBatch?.([payload, { tenantId: "tenant-a" }])).toThrow(z.ZodError);
      expect(processBatch).not.toHaveBeenCalled();
    });
  });
});
