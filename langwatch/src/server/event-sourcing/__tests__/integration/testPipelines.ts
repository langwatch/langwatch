import { z } from "zod";
import { createLogger } from "~/utils/logger/server";
import {
  type AggregateType,
  createTenantId,
  defineCommandSchema,
  type EventType,
  EventUtils,
} from "../../";
import type { Command, CommandHandler } from "../../commands/command";
import type { TenantId } from "../../domain/tenantId";
import type { Projection } from "../../domain/types";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore, MapProjectionDefinition } from "../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext";
import { getTestClickHouseClient } from "./testContainers";

const logger = createLogger(
  "langwatch:event-sourcing:tests:integration:test-pipelines",
);

// Test event type - now included in production schemas for validation
export const TEST_EVENT_TYPE = "test.integration.event" as const;
export const TEST_COMMAND_TYPE = "test.integration.command" as const;

export const testCommandPayloadSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  value: z.number(),
  message: z.string().optional(),
});

export type TestCommandPayload = z.infer<typeof testCommandPayloadSchema>;

export interface TestEventData {
  value: number;
  message?: string;
}

// TestEvent for integration tests - uses test types now included in production schemas
export interface TestEvent {
  id: string;
  aggregateId: string;
  aggregateType: "test_aggregate";
  tenantId: TenantId;
  timestamp: number;
  occurredAt: number;
  version: string;
  type: typeof TEST_EVENT_TYPE;
  data: TestEventData;
  metadata?: Record<string, unknown>;
}

export interface TestProjectionData {
  totalValue: number;
  eventCount: number;
  lastMessage?: string;
}

export interface TestProjection extends Projection<TestProjectionData> {
  data: TestProjectionData;
}

export class TestCommandHandler implements CommandHandler<
  Command<TestCommandPayload>,
  any
> {
  static readonly schema = defineCommandSchema(
    TEST_COMMAND_TYPE as any,
    testCommandPayloadSchema,
    "Test command for integration tests",
  );

  async handle(command: Command<TestCommandPayload>): Promise<TestEvent[]> {
    const tenantId = createTenantId(command.tenantId);
    const event = EventUtils.createEvent({
      aggregateType: "test_aggregate" as AggregateType,
      aggregateId: command.data.aggregateId,
      tenantId,
      type: TEST_EVENT_TYPE as EventType,
      version: "2025-12-17",
      data: {
        value: command.data.value,
        message: command.data.message,
      } satisfies TestEventData,
    });

    return [event as unknown as TestEvent];
  }

  static getAggregateId(payload: TestCommandPayload): string {
    return payload.aggregateId;
  }
}

/**
 * Record produced by the test map projection for storage in ClickHouse.
 */
export interface TestEventHandlerRecord {
  TenantId: string;
  AggregateId: string;
  EventId: string;
  EventTimestamp: number;
  Value: number;
  Message: string;
}

/**
 * AppendStore that writes mapped records to a ClickHouse table.
 */
class TestEventHandlerAppendStore implements AppendStore<TestEventHandlerRecord> {
  async append(record: TestEventHandlerRecord, _context: ProjectionStoreContext): Promise<void> {
    const clickHouseClient = getTestClickHouseClient();
    if (!clickHouseClient) {
      throw new Error("ClickHouse client not available");
    }

    // Ensure table exists
    await clickHouseClient.exec({
      query: `
        CREATE TABLE IF NOT EXISTS "test_langwatch".test_event_handler_log (
          TenantId String,
          AggregateId String,
          EventId String,
          EventTimestamp DateTime64(3),
          Value Int32,
          Message String
        )
        ENGINE = MergeTree()
        ORDER BY (TenantId, AggregateId, EventTimestamp)
      `,
    });

    // Insert processed event
    await clickHouseClient.insert({
      table: "test_langwatch.test_event_handler_log",
      values: [record],
      format: "JSONEachRow",
    });

    logger.debug(
      {
        tenantId: record.TenantId,
        aggregateId: record.AggregateId,
        eventId: record.EventId,
        value: record.Value,
      },
      "[TestEventHandlerAppendStore] Inserted event handler log",
    );
  }
}

/**
 * Test map projection that transforms events into records for ClickHouse storage.
 */
export const testMapProjection: MapProjectionDefinition<TestEventHandlerRecord, TestEvent> = {
  name: "testHandler",
  eventTypes: [TEST_EVENT_TYPE],
  map(event: TestEvent): TestEventHandlerRecord {
    return {
      TenantId: String(event.tenantId),
      AggregateId: event.aggregateId,
      EventId: event.id,
      EventTimestamp: event.timestamp,
      Value: Number(event.data.value),
      Message: String(event.data.message ?? ""),
    };
  },
  store: new TestEventHandlerAppendStore(),
};

/**
 * In-memory fold projection store for tests.
 */
class TestFoldProjectionStore implements FoldProjectionStore<TestProjectionData> {
  private data = new Map<string, TestProjectionData>();

  async get(_aggregateId: string, context: ProjectionStoreContext): Promise<TestProjectionData | null> {
    const key = `${context.tenantId}:${context.aggregateId}`;
    return this.data.get(key) ?? null;
  }

  async store(state: TestProjectionData, context: ProjectionStoreContext): Promise<void> {
    const key = `${context.tenantId}:${context.aggregateId}`;
    this.data.set(key, state);
  }
}

/**
 * Test fold projection that aggregates events into accumulated state.
 */
export const testFoldProjection: FoldProjectionDefinition<TestProjectionData, TestEvent> = {
  name: "testProjection",
  version: "2025-01-01",
  eventTypes: [TEST_EVENT_TYPE],

  init(): TestProjectionData {
    return {
      totalValue: 0,
      eventCount: 0,
      lastMessage: undefined,
    };
  },

  apply(state: TestProjectionData, event: TestEvent): TestProjectionData {
    // Ensure value is coerced to number (ClickHouse may return strings)
    const value =
      typeof event.data.value === "number"
        ? event.data.value
        : Number(event.data.value);

    return {
      totalValue: state.totalValue + value,
      eventCount: state.eventCount + 1,
      lastMessage: event.data.message ?? state.lastMessage,
    };
  },

  store: new TestFoldProjectionStore(),
};
