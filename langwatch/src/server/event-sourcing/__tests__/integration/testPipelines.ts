import { z } from "zod";
import type { Command, CommandHandler } from "../../library/commands/command";
import type { EventHandler } from "../../library/domain/handlers/eventHandler";
import type { ProjectionHandler } from "../../library/domain/handlers/projectionHandler";
import type { EventStream } from "../../library/streams/eventStream";
import type { Projection } from "../../library/domain/types";
import type { TenantId } from "../../library/domain/tenantId";
import type { ProjectionStore } from "../../library/stores/projectionStore.types";
import {
  EventUtils,
  createTenantId,
  defineCommandSchema,
  type AggregateType,
  type EventType,
} from "../../library";
import { getTestClickHouseClient } from "./testContainers";
import { type ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger";

const logger = createLogger(
  "langwatch:event-sourcing:tests:integration:test-pipelines",
);

// ============================================================================
// Type Identifiers
// ============================================================================

// Test event type - now included in production schemas for validation
export const TEST_EVENT_TYPE = "test.integration.event" as const;
export const TEST_COMMAND_TYPE = "test.integration.command" as const;

// ============================================================================
// Schemas
// ============================================================================

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

// ============================================================================
// Command Handler
// ============================================================================

export class TestCommandHandler
  implements CommandHandler<Command<TestCommandPayload>, any>
{
  static readonly schema = defineCommandSchema(
    TEST_COMMAND_TYPE as any,
    testCommandPayloadSchema,
    "Test command for integration tests",
  );

  async handle(command: Command<TestCommandPayload>): Promise<TestEvent[]> {
    const tenantId = createTenantId(command.tenantId);
    const event = EventUtils.createEvent(
      "test_aggregate" as AggregateType,
      command.data.aggregateId,
      tenantId,
      TEST_EVENT_TYPE as EventType,
      {
        value: command.data.value,
        message: command.data.message,
      } satisfies TestEventData,
    );

    return [event as unknown as TestEvent];
  }

  static getAggregateId(payload: TestCommandPayload): string {
    return payload.aggregateId;
  }
}

// ============================================================================
// Event Handler
// ============================================================================

/**
 * Test event handler that writes processed events to a ClickHouse table.
 */
export class TestEventHandler implements EventHandler<any> {
  private clickHouseClient: ClickHouseClient | null = null;

  constructor() {
    this.clickHouseClient = getTestClickHouseClient();
  }

  static getEventTypes() {
    return [TEST_EVENT_TYPE] as const;
  }

  async handle(event: TestEvent): Promise<void> {
    if (!this.clickHouseClient) {
      throw new Error("ClickHouse client not available");
    }

    // Ensure table exists
    await this.clickHouseClient.exec({
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
    // Use the same approach as eventRepositoryClickHouse.ts - pass timestamp as number
    // The ClickHouse client handles DateTime64(3) columns correctly with numbers
    await this.clickHouseClient.insert({
      table: "test_langwatch.test_event_handler_log",
      values: [
        {
          TenantId: String(event.tenantId),
          AggregateId: event.aggregateId,
          EventId: event.id,
          EventTimestamp: event.timestamp, // Number (Unix timestamp in milliseconds) - same as eventRepositoryClickHouse.ts
          Value: Number(event.data.value),
          Message: String(event.data.message ?? ""),
        },
      ],
      format: "JSONEachRow",
    });

    logger.debug(
      {
        tenantId: String(event.tenantId),
        aggregateId: event.aggregateId,
        eventId: event.id,
        value: event.data.value,
      },
      "[TestEventHandler] Inserted event handler log",
    );
  }
}

// ============================================================================
// Projection Handler
// ============================================================================

/**
 * In-memory projection store for tests.
 */
class TestProjectionStore implements ProjectionStore<TestProjection> {
  private store = new Map<string, TestProjection>();

  async getProjection(
    aggregateId: string,
    context: { tenantId: TenantId },
  ): Promise<TestProjection | null> {
    const key = `${context.tenantId}:${aggregateId}`;
    return this.store.get(key) ?? null;
  }

  async storeProjection(
    projection: TestProjection,
    context: { tenantId: TenantId },
  ): Promise<void> {
    const key = `${context.tenantId}:${projection.aggregateId}`;
    this.store.set(key, projection);
  }
}

/**
 * Test projection handler that aggregates events into a projection.
 */
export class TestProjectionHandler
  implements ProjectionHandler<any, TestProjection>
{
  static readonly store = new TestProjectionStore();

  handle(stream: EventStream<TenantId, any>): TestProjection {
    const events = stream.getEvents() as TestEvent[];
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    let totalValue = 0;
    let lastMessage: string | undefined;

    for (const event of events) {
      // Ensure value is coerced to number (ClickHouse may return strings)
      const value =
        typeof event.data.value === "number"
          ? event.data.value
          : Number(event.data.value);
      totalValue += value;
      if (event.data.message) {
        lastMessage = event.data.message;
      }
    }

    return {
      id: `test:${aggregateId}`,
      aggregateId,
      tenantId,
      version:
        events.length > 0 ? events[events.length - 1]!.timestamp : Date.now(),
      data: {
        totalValue,
        eventCount: events.length,
        lastMessage,
      },
    };
  }
}
