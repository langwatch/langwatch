import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../../";
import {
	cleanupTestDataForTenant,
	closePipelineGracefully,
	createTestPipeline,
	createTestTenantId,
	generateTestAggregateId,
	getTenantIdString,
	waitForEventHandler,
	waitForProjection,
} from "./testHelpers";
import type { TestEvent, TestProjection } from "./testPipelines";

describe("Event Sourcing", () => {
  let pipeline: ReturnType<typeof createTestPipeline>;
  let tenantId: ReturnType<typeof createTestTenantId>;
  let tenantIdString: string;

  beforeEach(async () => {
    pipeline = createTestPipeline();
    tenantId = createTestTenantId();
    tenantIdString = getTenantIdString(tenantId);
    await pipeline.ready();
  });

  afterEach(async () => {
    await closePipelineGracefully(pipeline);
    await cleanupTestDataForTenant(tenantIdString);
  });

  describe("given a pipeline with a command, fold projection, and map projection", () => {
    describe("when a command is sent", () => {
      it("stores the event in the event store", async () => {
        const aggregateId = generateTestAggregateId("store-event");

        await pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 10,
          message: "hello",
        });

        await waitForEventHandler(aggregateId, tenantIdString, 1, 10000);

        const events = await pipeline.eventStore.getEvents(
          aggregateId,
          { tenantId },
          "test_aggregate" as AggregateType,
        );

        expect(events).toHaveLength(1);
        const event = events[0] as TestEvent;
        expect(event.data.value).toBe(10);
        expect(event.data.message).toBe("hello");
        expect(event.aggregateId).toBe(aggregateId);
      });

      it("updates the fold projection with the event data", async () => {
        const aggregateId = generateTestAggregateId("fold-update");

        await pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 42,
          message: "fold test",
        });

        await waitForProjection(
          pipeline,
          "testProjection",
          aggregateId,
          tenantId,
          1,
          10000,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "testProjection",
          aggregateId,
          { tenantId },
        )) as TestProjection | null;

        expect(projection).toBeDefined();
        expect(projection?.data.totalValue).toBe(42);
        expect(projection?.data.eventCount).toBe(1);
        expect(projection?.data.lastMessage).toBe("fold test");
      });

      it("writes a record to the map projection store", async () => {
        const aggregateId = generateTestAggregateId("map-write");

        await pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 7,
          message: "map test",
        });

        await waitForEventHandler(aggregateId, tenantIdString, 1, 10000);

        // The map projection writes to test_event_handler_log in ClickHouse.
        // waitForEventHandler already confirmed the row exists — verify event count.
        const events = await pipeline.eventStore.getEvents(
          aggregateId,
          { tenantId },
          "test_aggregate" as AggregateType,
        );
        expect(events).toHaveLength(1);
      });
    });

    describe("when an invalid command payload is sent", () => {
      it("rejects with a validation error", async () => {
        const aggregateId = generateTestAggregateId("invalid-cmd");

        await expect(
          pipeline.commands.testCommand.send({
            tenantId: tenantIdString,
            aggregateId,
            // missing required 'value' field
          }),
        ).rejects.toThrow();
      });
    });

    describe("when multiple events arrive for the same aggregate", () => {
      it("accumulates fold state incrementally", async () => {
        const aggregateId = generateTestAggregateId("incremental");

        await pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 5,
          message: "first",
        });

        await waitForProjection(
          pipeline,
          "testProjection",
          aggregateId,
          tenantId,
          1,
          10000,
        );

        await pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 10,
          message: "second",
        });

        await pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 15,
          message: "third",
        });

        await waitForProjection(
          pipeline,
          "testProjection",
          aggregateId,
          tenantId,
          3,
          20000,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "testProjection",
          aggregateId,
          { tenantId },
        )) as TestProjection | null;

        expect(projection?.data.totalValue).toBe(30); // 5 + 10 + 15
        expect(projection?.data.eventCount).toBe(3);
        expect(projection?.data.lastMessage).toBe("third");
      });
    });

    describe("when concurrent commands target the same aggregate", () => {
      it("stores all events without data loss", async () => {
        const aggregateId = generateTestAggregateId("concurrent");

        await Promise.all([
          pipeline.commands.testCommand.send({
            tenantId: tenantIdString,
            aggregateId,
            value: 1,
          }),
          pipeline.commands.testCommand.send({
            tenantId: tenantIdString,
            aggregateId,
            value: 2,
          }),
        ]);

        await waitForEventHandler(aggregateId, tenantIdString, 2, 15000);

        const events = await pipeline.eventStore.getEvents(
          aggregateId,
          { tenantId },
          "test_aggregate" as AggregateType,
        );

        expect(events).toHaveLength(2);
      });
    });

    describe("when events arrive for different aggregates", () => {
      it("processes each aggregate independently", async () => {
        const ids = [
          generateTestAggregateId("agg-1"),
          generateTestAggregateId("agg-2"),
          generateTestAggregateId("agg-3"),
        ];

        await Promise.all(
          ids.map((aggregateId, i) =>
            pipeline.commands.testCommand.send({
              tenantId: tenantIdString,
              aggregateId,
              value: (i + 1) * 10,
              message: `aggregate-${i + 1}`,
            }),
          ),
        );

        await Promise.all(
          ids.map((id) =>
            waitForProjection(pipeline, "testProjection", id, tenantId, 1, 10000),
          ),
        );

        for (let i = 0; i < ids.length; i++) {
          const projection = (await pipeline.service.getProjectionByName(
            "testProjection",
            ids[i]!,
            { tenantId },
          )) as TestProjection | null;

          expect(projection?.data.totalValue).toBe((i + 1) * 10);
          expect(projection?.data.eventCount).toBe(1);
        }
      });
    });

    describe("when rapid events trigger queue deduplication", () => {
      it("processes all events regardless of queue merging", async () => {
        const aggregateId = generateTestAggregateId("dedup");

        // Fire all commands without awaiting individually — BullMQ may deduplicate jobs
        const promises = [
          pipeline.commands.testCommand.send({
            tenantId: tenantIdString,
            aggregateId,
            value: 1,
            message: "first",
          }),
          pipeline.commands.testCommand.send({
            tenantId: tenantIdString,
            aggregateId,
            value: 2,
            message: "second",
          }),
          pipeline.commands.testCommand.send({
            tenantId: tenantIdString,
            aggregateId,
            value: 3,
            message: "third",
          }),
        ];

        await Promise.all(promises);

        await waitForProjection(
          pipeline,
          "testProjection",
          aggregateId,
          tenantId,
          3,
          30000,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "testProjection",
          aggregateId,
          { tenantId },
        )) as TestProjection | null;

        expect(projection?.data.totalValue).toBe(6); // 1 + 2 + 3
        expect(projection?.data.eventCount).toBe(3);
      });
    });

    describe("when events are stored directly via storeEvents API", () => {
      it("dispatches to fold and map projections", async () => {
        const aggregateId = generateTestAggregateId("direct-store");

        const event1 = EventUtils.createEvent({
          aggregateType: "test_aggregate" as AggregateType,
          aggregateId,
          tenantId,
          type: "test.integration.event" as const,
          version: "2025-12-17",
          data: { value: 5 },
        });
        const event2 = EventUtils.createEvent({
          aggregateType: "test_aggregate" as AggregateType,
          aggregateId,
          tenantId,
          type: "test.integration.event" as const,
          version: "2025-12-17",
          data: { value: 10 },
        });

        await pipeline.service.storeEvents([event1, event2] as TestEvent[], {
          tenantId,
        });

        await waitForProjection(
          pipeline,
          "testProjection",
          aggregateId,
          tenantId,
          2,
          15000,
        );

        const projection = (await pipeline.service.getProjectionByName(
          "testProjection",
          aggregateId,
          { tenantId },
        )) as TestProjection | null;

        expect(projection?.data.totalValue).toBe(15); // 5 + 10
        expect(projection?.data.eventCount).toBe(2);

        // Map projection should also have processed both events
        await waitForEventHandler(aggregateId, tenantIdString, 2, 10000);
      });
    });
  });
}, 60000);
