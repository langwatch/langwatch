import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AggregateType } from "../../domain/aggregateType";
import { COMMAND_TYPES } from "../../domain/commandType";
import { EVENT_TYPES } from "../../domain/eventType";
import { createTenantId } from "../../domain/tenantId";
import type { Event, EventMetadataBase } from "../../domain/types";
import type { Command } from "../command";
import { defineCommandSchema } from "../commandSchema";

interface TestPayload {
  id: string;
  value: number;
}

interface TestMetadata extends EventMetadataBase {
  correlationId: string;
}

// type _TestCommandType = (typeof COMMAND_TYPES)[number];
type TestEventType = (typeof EVENT_TYPES)[number];

interface TestEvent extends Event<{ result: string }, TestMetadata> {
  type: TestEventType;
}

const testPayloadSchema = z.object({
  id: z.string(),
  value: z.number(),
});

describe("CommandHandlerClass", () => {
  describe("when implementing a minimal CommandHandlerClass", () => {
    it("can call getAggregateId static method", () => {
      class MinimalHandler {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return [];
        }
      }

      const payload: TestPayload = { id: "aggregate-123", value: 42 };
      const aggregateId = MinimalHandler.getAggregateId(payload);

      expect(aggregateId).toBe("aggregate-123");
    });

    it("can call handle instance method", async () => {
      class MinimalHandler {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return [
            {
              id: "event-1",
              aggregateId: command.aggregateId,
              aggregateType: "test_aggregate" as AggregateType,
              tenantId: command.tenantId,
              timestamp: 1234567890,
              occurredAt: 1234567890,
              type: EVENT_TYPES[0],
              data: { result: "success" },
              version: "2025-12-17",
            },
          ];
        }
      }

      const handler = new MinimalHandler();
      const tenantId = createTenantId("tenant-123");
      const command: Command<TestPayload> = {
        tenantId,
        aggregateId: "aggregate-456",
        type: COMMAND_TYPES[0],
        data: { id: "aggregate-456", value: 42 },
      };

      const result = await handler.handle(command);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id", "event-1");
      expect(result[0]).toHaveProperty("aggregateId", "aggregate-456");
      expect(result[0]).toHaveProperty("tenantId", tenantId);
    });
  });

  describe("when implementing a CommandHandlerClass with optional methods", () => {
    it("can define optional getSpanAttributes static method", () => {
      class HandlerWithSpanAttributes {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        static getSpanAttributes(
          payload: TestPayload,
        ): Record<string, string | number | boolean> {
          return {
            "payload.id": payload.id,
            "payload.value": payload.value,
          };
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return [];
        }
      }

      const payload: TestPayload = { id: "test-id", value: 100 };
      const attributes = HandlerWithSpanAttributes.getSpanAttributes?.(payload);

      expect(attributes).toBeDefined();
      expect(attributes).toEqual({
        "payload.id": "test-id",
        "payload.value": 100,
      });
    });

    it("can define optional makeJobId static method", () => {
      class HandlerWithJobId {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        static makeJobId(payload: TestPayload): string {
          return `job-${payload.id}-${payload.value}`;
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return [];
        }
      }

      const payload: TestPayload = { id: "test-id", value: 42 };
      const jobId = HandlerWithJobId.makeJobId?.(payload);

      expect(jobId).toBe("job-test-id-42");
    });
  });

  describe("when implementing a CommandHandlerClass with optional properties", () => {
    it("can define optional delay property", () => {
      class HandlerWithDelay {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static delay = 1000;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return [];
        }
      }

      expect(HandlerWithDelay.delay).toBe(1000);
    });

    it("can define optional concurrency property", () => {
      class HandlerWithConcurrency {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static concurrency = 5;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return [];
        }
      }

      expect(HandlerWithConcurrency.concurrency).toBe(5);
    });
  });

  describe("when handle method returns different result types", () => {
    it("can return a Promise of events", async () => {
      class AsyncHandler {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        async handle(command: Command<TestPayload>): Promise<TestEvent[]> {
          return Promise.resolve([
            {
              id: "event-1",
              aggregateType: "test_aggregate" as AggregateType,
              aggregateId: command.aggregateId,
              tenantId: command.tenantId,
              timestamp: 1234567890,
              occurredAt: 1234567890,
              type: EVENT_TYPES[0],
              data: { result: "async" },
              version: "2025-12-17",
            },
          ]);
        }
      }

      const handler = new AsyncHandler();
      const tenantId = createTenantId("tenant-123");
      const command: Command<TestPayload> = {
        tenantId,
        aggregateId: "aggregate-456",
        type: COMMAND_TYPES[0],
        data: { id: "aggregate-456", value: 42 },
      };

      const result = await handler.handle(command);

      expect(result).toHaveLength(1);
      expect(result[0]?.data.result).toBe("async");
    });

    it("can return events directly (synchronous)", async () => {
      class SyncHandler {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testPayloadSchema,
        );

        static readonly dispatcherName = "test-dispatcher" as const;

        static getAggregateId(payload: TestPayload): string {
          return payload.id;
        }

        handle(command: Command<TestPayload>): TestEvent[] {
          return [
            {
              id: "event-1",
              aggregateType: "test_aggregate" as AggregateType,
              aggregateId: command.aggregateId,
              tenantId: command.tenantId,
              timestamp: 1234567890,
              occurredAt: 1234567890,
              type: EVENT_TYPES[0],
              data: { result: "sync" },
              version: "2025-12-17",
            },
          ];
        }
      }

      const handler = new SyncHandler();
      const tenantId = createTenantId("tenant-123");
      const command: Command<TestPayload> = {
        tenantId,
        aggregateId: "aggregate-456",
        type: COMMAND_TYPES[0],
        data: { id: "aggregate-456", value: 42 },
      };

      const result = handler.handle(command);

      expect(result).toHaveLength(1);
      expect(result[0]?.data.result).toBe("sync");
    });
  });
});
