import { describe, expect, it } from "vitest";
import { z } from "zod";
import { definePipeline } from "../pipeline/definePipeline";
import { memoryClock, memoryEventLog } from "./memory";
import { createEventSourcingService } from "./service";

/** A payload far larger than any sort key should ever carry. */
const fatPayload = { traceId: "t-1", blob: "x".repeat(200_000) };

function serviceWithFatCommand() {
  const eventLog = memoryEventLog();
  const pipeline = definePipeline("trace")
    .prefix("lw.obs")
    .events({
      spanReceived: z.object({ traceId: z.string(), blob: z.string() }),
    })
    .id({ spanReceived: (data) => data.traceId })
    .withCommand("recordSpan", {
      input: z.object({ traceId: z.string(), blob: z.string() }),
      handle: (input) =>
        Promise.resolve([{ type: "spanReceived" as const, data: input }]),
    })
    .build();

  const service = createEventSourcingService({
    ports: {
      eventLog,
      clock: memoryClock(1_000),
      queue: undefined as never,
      spool: undefined as never,
      processStore: undefined as never,
      outbox: undefined as never,
    },
  });
  service.register(pipeline);
  return { service, eventLog };
}

describe("a committed event's idempotency key", () => {
  describe("given a command whose payload is far larger than a sort key should hold", () => {
    it("keys the row on a bounded hash rather than the payload itself", async () => {
      const { service } = serviceWithFatCommand();

      const { events } = await service.commands.send("recordSpan", fatPayload, {
        tenantId: "project-1",
      });

      const key = events[0]?.idempotencyKey ?? "";
      // event_log's sort key is (TenantId, AggregateType, AggregateId,
      // IdempotencyKey), so this value lands in the primary index.
      expect(key.length).toBeLessThan(128);
      expect(key).not.toContain("x".repeat(64));
      expect(events[0]?.payload).toContain("x".repeat(64));
    });
  });

  describe("given the same command dispatched twice with the same input", () => {
    it("mints the same key, so the retry collapses onto one row", async () => {
      const { service, eventLog } = serviceWithFatCommand();

      const first = await service.commands.send("recordSpan", fatPayload, {
        tenantId: "project-1",
      });
      const second = await service.commands.send("recordSpan", fatPayload, {
        tenantId: "project-1",
      });

      expect(second.events[0]?.idempotencyKey).toBe(first.events[0]?.idempotencyKey);
      // The in-memory log dedupes on the deployed sort key's tuple.
      expect(eventLog.rows).toHaveLength(1);
    });
  });

  describe("given two commands whose payloads differ", () => {
    it("mints different keys, so neither collapses onto the other", async () => {
      const { service, eventLog } = serviceWithFatCommand();

      const a = await service.commands.send(
        "recordSpan",
        { traceId: "t-1", blob: "a" },
        { tenantId: "project-1" },
      );
      const b = await service.commands.send(
        "recordSpan",
        { traceId: "t-1", blob: "b" },
        { tenantId: "project-1" },
      );

      expect(b.events[0]?.idempotencyKey).not.toBe(a.events[0]?.idempotencyKey);
      expect(eventLog.rows).toHaveLength(2);
    });
  });
});
