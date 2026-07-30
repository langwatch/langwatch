import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { TenantId } from "../../domain/tenantId";
import { defineCommand } from "../defineCommand";

const testEventDataSchema = z.object({
  batchRunId: z.string(),
  suiteId: z.string(),
  total: z.number(),
});

const TestCommand = defineCommand({
  commandType: "test.integration.command" as const,
  eventType: "test.integration.event" as const,
  eventVersion: "2026-03-01",
  aggregateType: "test_aggregate",
  schema: testEventDataSchema,
  aggregateId: (d) => d.batchRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}`,
  spanAttributes: (d) => ({
    "payload.batchRun.id": d.batchRunId,
    "payload.suite.id": d.suiteId,
  }),
});

function makeTestCommand(tenantId = "tenant-1") {
  return {
    tenantId: tenantId as TenantId,
    aggregateId: "batch-1",
    type: "test.integration.command" as const,
    data: {
      tenantId: "tenant-1",
      occurredAt: 1700000000000,
      batchRunId: "batch-1",
      suiteId: "suite-1",
      total: 3,
    },
  };
}

describe("defineCommand()", () => {
  describe("returned class", () => {
    it("has a zero-arg constructor", () => {
      const handler = new TestCommand();
      expect(handler).toBeDefined();
    });

    it("exposes a static schema with correct command type", () => {
      expect(TestCommand.schema.type).toBe("test.integration.command");
    });

    it("exposes static getAggregateId", () => {
      const payload = {
        tenantId: "t-1",
        occurredAt: 1700000000000,
        batchRunId: "batch-1",
        suiteId: "suite-1",
        total: 3,
      };
      expect(TestCommand.getAggregateId(payload)).toBe("batch-1");
    });

    it("exposes static getSpanAttributes", () => {
      const payload = {
        tenantId: "t-1",
        occurredAt: 1700000000000,
        batchRunId: "batch-1",
        suiteId: "suite-1",
        total: 3,
      };
      expect(TestCommand.getSpanAttributes!(payload)).toEqual({
        "payload.batchRun.id": "batch-1",
        "payload.suite.id": "suite-1",
      });
    });
  });

  describe("handle()", () => {
    it("emits a single event with correct type", async () => {
      const handler = new TestCommand();
      const events = await handler.handle(makeTestCommand());

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("test.integration.event");
    });

    it("strips envelope fields from event data", async () => {
      const handler = new TestCommand();
      const events = await handler.handle(makeTestCommand());

      expect(events[0]!.data).toEqual({
        batchRunId: "batch-1",
        suiteId: "suite-1",
        total: 3,
      });
    });

    it("uses occurredAt from command data", async () => {
      const handler = new TestCommand();
      const cmd = makeTestCommand();
      cmd.data.occurredAt = 1700000099999;
      const events = await handler.handle(cmd);

      expect(events[0]!.occurredAt).toBe(1700000099999);
    });

    it("sets correct aggregate fields on the event", async () => {
      const handler = new TestCommand();
      const events = await handler.handle(makeTestCommand());

      const event = events[0]!;
      expect(event.aggregateType).toBe("test_aggregate");
      expect(event.aggregateId).toBe("batch-1");
      expect(event.tenantId).toBe("tenant-1");
    });

    it("sets idempotencyKey on the event", async () => {
      const handler = new TestCommand();
      const events = await handler.handle(makeTestCommand());

      expect(events[0]!.idempotencyKey).toBe("tenant-1:batch-1");
    });
  });

  describe("when spanAttributes is not provided", () => {
    const MinimalCommand = defineCommand({
      commandType: "test.integration.command" as const,
      eventType: "test.integration.event" as const,
      eventVersion: "2026-03-01",
      aggregateType: "test_aggregate",
      schema: testEventDataSchema,
      aggregateId: (d) => d.batchRunId,
      idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}`,
    });

    it("does not expose getSpanAttributes", () => {
      expect(MinimalCommand.getSpanAttributes).toBeUndefined();
    });
  });

  /**
   * A command declares exactly one key — `idempotencyKey`, which the event
   * store applies AFTER the handler has run. Enqueue-level deduplication is a
   * pipeline wiring decision (`deduplication: { makeId, ttlMs }`); nothing a
   * command declares can suppress a job.
   *
   * ~30 commands used to carry a `makeJobId` static that read as a dedup key
   * and was consulted by nothing. Reinstating one would be silent: it would
   * look like it deduped and would not. This pins the surface so it cannot
   * come back by accident.
   */
  describe("given the command is asked for a dedup key", () => {
    it("exposes no job-key or dedup surface beyond the event's idempotencyKey", () => {
      const keyish = Object.getOwnPropertyNames(TestCommand).filter((name) =>
        /jobid|dedup/i.test(name),
      );

      expect(keyish).toEqual([]);
    });

    describe("when the same command runs twice on identical data", () => {
      it("mints the same idempotencyKey, which is the only collapse it guarantees", async () => {
        const handler = new TestCommand();

        const [first] = await handler.handle(makeTestCommand());
        const [second] = await handler.handle(makeTestCommand());

        expect(first!.idempotencyKey).toBe(second!.idempotencyKey);
        expect(first!.id).not.toBe(second!.id);
      });
    });
  });

  describe("schema validation", () => {
    it("validates command data with envelope fields", () => {
      const result = TestCommand.schema.validate({
        tenantId: "t-1",
        occurredAt: 1700000000000,
        batchRunId: "batch-1",
        suiteId: "suite-1",
        total: 3,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid command data", () => {
      const result = TestCommand.schema.validate({
        tenantId: "t-1",
        // missing occurredAt and domain fields
      });
      expect(result.success).toBe(false);
    });
  });
});
