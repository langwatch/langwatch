import { describe, expect, it } from "vitest";
import {
  createTraceProcessingPipeline,
  spanStorageGroupKey,
  traceCommandGroupKey,
  traceFoldGroupKey,
} from "../index";
import {
  recordSpanCommandGroupKey,
  resolveSpanCommandShardCount,
  shardIndexFor,
} from "../spanSharding";
import {
  storedSpansTable,
  traceAnalyticsTable,
  traceSummariesTable,
} from "../table";
import { canonicalSpan, createFakeClient, TRACE_ID } from "./fixtures";

const ctx = { now: Date.now(), tenantId: "tenant-1" };

describe("the trace-processing composition", () => {
  describe("given the projections this pipeline mounts", () => {
    /** @scenario "A projection declares the events it subscribes to" */
    it("declares each fold's subscribed event types", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      expect([...built.folds.traceSummary!.eventTypes].sort()).toEqual(
        [...built.eventTypes].sort(),
      );
      expect([...built.folds.traceAnalytics!.eventTypes].sort()).toEqual(
        [
          "lw.obs.trace.annotation_added",
          "lw.obs.trace.annotation_removed",
          "lw.obs.trace.annotations_bulk_synced",
          "lw.obs.trace.origin_resolved",
          "lw.obs.trace.span_received",
          "lw.obs.trace.topic_assigned",
          "lw.obs.trace.trace_name_changed",
        ].sort(),
      );
    });

    /** @scenario "A map projection declares the events it subscribes to" */
    it("declares the map's single subscribed event type", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });
      expect(built.maps.spanStorage!.eventTypes).toEqual([
        "lw.obs.trace.span_received",
      ]);
    });

    /** @scenario "An event the projection did not subscribe to leaves the state alone" */
    it("still counts an event it declares no handler for as applied, but runs no logic for it", async () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const result = await built.folds.traceAnalytics!.apply({
        key: TRACE_ID,
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.log_contributed",
            data: { traceId: TRACE_ID, spanId: "s1" },
          },
        ],
      });

      expect(result.events).toBe(1);
    });

    /** @scenario "Skipping events" */
    it("maps nothing for an event the span store does not subscribe to", async () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const result = await built.maps.spanStorage!.apply({
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.topic_assigned",
            data: { traceId: TRACE_ID, topicId: null },
          },
        ],
      });

      expect(result).toEqual({ written: 0 });
    });
  });

  describe("given a command", () => {
    it("stamps the pipeline's derived persisted type onto the emitted event", async () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });
      const span = canonicalSpan({ spanId: "s1" });

      const emitted = await built.commands.recordSpan!.handle(span, ctx);

      expect(emitted).toEqual([
        { type: "lw.obs.trace.span_received", data: span },
      ]);
    });

    it("rejects an input its own schema does not accept", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      expect(() =>
        built.commands.changeTraceName!.input.parse({
          traceId: TRACE_ID,
          newName: "",
          changedByUserId: null,
          changedAt: 1,
        }),
      ).toThrow();
    });
  });

  describe("given a delivery of spans", () => {
    it("writes one insert for the whole batch, not one per span", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.maps.spanStorage!.apply({
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s1" }),
          },
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s2" }),
          },
        ],
      });

      expect(result).toEqual({ written: 2 });
      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe(storedSpansTable.name);
      expect(client.insertCalls[0]?.rows).toHaveLength(2);
      expect(client.insertCalls[0]?.columns).toEqual(
        storedSpansTable.columnNames,
      );
    });

    it("folds a batch into one summary row keyed by the trace", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceSummary!.apply({
        key: TRACE_ID,
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s1" }),
          },
        ],
      });

      expect(result).toEqual({ events: 1 });
      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe(traceSummariesTable.name);
    });

    it("folds a batch into one analytics row keyed by the trace", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceAnalytics!.apply({
        key: TRACE_ID,
        tenantId: "tenant-1",
        events: [
          {
            type: "lw.obs.trace.span_received",
            data: canonicalSpan({ spanId: "s1" }),
          },
        ],
      });

      expect(result).toEqual({ events: 1 });
      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe(traceAnalyticsTable.name);
    });
  });

  describe("given the dispatch lanes this pipeline uses", () => {
    /** @scenario "Sharding disabled keeps the historic trace-only group key" */
    it("keeps recordSpan on the trace's own lane while sharding is off", () => {
      expect(
        recordSpanCommandGroupKey({
          tenantId: "tenant-1",
          traceId: TRACE_ID,
          spanId: "s1",
        }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "command", name: "recordSpan" },
        scope: {
          kind: "aggregate",
          aggregateType: "trace",
          aggregateId: TRACE_ID,
        },
      });
    });

    /** @scenario "Sharding spreads a trace's spans across groups" */
    it("splits one trace's spans across lanes once sharding is on", () => {
      const keys = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map(
        (spanId) =>
          recordSpanCommandGroupKey({
            tenantId: "tenant-1",
            traceId: TRACE_ID,
            spanId,
            shardCount: 4,
          }).scope,
      );

      const distinct = new Set(keys.map((scope) => JSON.stringify(scope)));
      expect(distinct.size).toBeGreaterThan(1);
      for (const scope of keys) {
        expect(scope).toMatchObject({ kind: "partition" });
      }
    });

    /** @scenario "A span always maps to the same shard" */
    it("sends the same span id to the same shard every time", () => {
      expect(shardIndexFor("span-abc", 16)).toBe(shardIndexFor("span-abc", 16));
      expect(shardIndexFor("span-abc", 16)).toBeLessThan(16);
    });

    /** @scenario "The configured shard count is clamped to a safe range" */
    it("clamps an unusable shard count down to disabled", () => {
      expect(resolveSpanCommandShardCount(undefined)).toBe(1);
      expect(resolveSpanCommandShardCount("0")).toBe(1);
      expect(resolveSpanCommandShardCount("-4")).toBe(1);
      expect(resolveSpanCommandShardCount("not-a-number")).toBe(1);
      expect(resolveSpanCommandShardCount("1000")).toBe(128);
      expect(resolveSpanCommandShardCount("8")).toBe(8);
    });

    /** @scenario "The pipeline shards the command while leaving the fold per-trace" */
    it("keeps both folds on one lane per trace however the command shards", () => {
      const summaryLane = traceFoldGroupKey({
        tenantId: "tenant-1",
        projection: "traceSummary",
        traceId: TRACE_ID,
      });
      const analyticsLane = traceFoldGroupKey({
        tenantId: "tenant-1",
        projection: "traceAnalytics",
        traceId: TRACE_ID,
      });

      expect(summaryLane.scope).toEqual({
        kind: "aggregate",
        aggregateType: "trace",
        aggregateId: TRACE_ID,
      });
      expect(analyticsLane.scope).toEqual(summaryLane.scope);
      expect(analyticsLane.lane).not.toEqual(summaryLane.lane);
    });

    it("puts each stored span on its own lane, so nothing serialises them", () => {
      expect(
        spanStorageGroupKey({ tenantId: "tenant-1", eventId: "evt-1" }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "map", name: "spanStorage" },
        scope: { kind: "event", eventId: "evt-1" },
      });
    });

    it("puts every other command on the trace's own lane", () => {
      expect(
        traceCommandGroupKey({
          tenantId: "tenant-1",
          command: "assignTopic",
          traceId: TRACE_ID,
        }),
      ).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "command", name: "assignTopic" },
        scope: {
          kind: "aggregate",
          aggregateType: "trace",
          aggregateId: TRACE_ID,
        },
      });
    });
  });
});
