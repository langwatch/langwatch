/**
 * @vitest-environment node
 * Dropped dispatches log as error since this is the last place to report loss.
 * See specs/observability/retryable-failure-log-level.feature.
 */
import { createTestLogger, type TestLogLine } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import type { EventSourcedQueueProcessor } from "../../queues/index.ts";
import {
  createMockFoldProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  parseTestEvent,
} from "../../services/__tests__/testHelpers.ts";
import type { EventStoreReadContext } from "../../stores/eventStore.types.ts";
import { ProjectionRegistry } from "../projectionRegistry.ts";

const WARN = 40;
const ERROR = 50;

function registryWithAProjection() {
  const { logger, lines } = createTestLogger();
  const registry = new ProjectionRegistry({ logger, parseEvent: parseTestEvent });
  registry.registerFoldProjection(createMockFoldProjectionDefinition("any-fold"));
  return { registry, lines };
}

/** A registry that had a router and lost it to `close()` — the case the bound scenario names. */
async function registryClosedAfterRouting() {
  const built = registryWithAProjection();
  const globalQueue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
  built.registry.initialize(globalQueue, new Map());
  await built.registry.close();
  return built;
}

function atLevel(lines: TestLogLine[], level: number): TestLogLine[] {
  return lines.filter((line) => line.level === level);
}

const events = [
  createTestEvent("aggregate-1", createTestAggregateType(), createTestTenantId()),
  createTestEvent("aggregate-2", createTestAggregateType(), createTestTenantId()),
];
const context: EventStoreReadContext = { tenantId: createTestTenantId() };

describe("dispatching to a projection registry with no router", () => {
  describe("given close() has cleared a router that was there", () => {
    describe("when events are dispatched afterwards", () => {
      /** @scenario "Dropping events after the projection router is gone is an error" */
      /** @scenario "A dispatch arriving after the router is gone is still reported" */
      it("logs at error level", async () => {
        const { registry, lines } = await registryClosedAfterRouting();

        await registry.dispatch(events, context);

        expect(atLevel(lines, ERROR)).toHaveLength(1);
        expect(atLevel(lines, WARN)).toHaveLength(0);
      });

      /** @scenario "Work discarded without a throw is logged at error" */
      /** @scenario "A dispatch arriving after the router is gone is still reported" */
      it("states how many events were discarded", async () => {
        const { registry, lines } = await registryClosedAfterRouting();

        await registry.dispatch(events, context);

        expect(atLevel(lines, ERROR)[0]).toMatchObject({ eventCount: 2 });
      });

      /** @scenario "A dispatch arriving after the router is gone is still reported" */
      it("does not blame initialize() alone, since close() clears the router too", async () => {
        const { registry, lines } = await registryClosedAfterRouting();

        await registry.dispatch(events, context);

        expect(atLevel(lines, ERROR)[0]?.msg).toContain("already closed");
      });
    });
  });

  describe("given the router was never initialized", () => {
    describe("when events are dispatched", () => {
      /** @scenario "Dropping events after the projection router is gone is an error" */
      it("logs at error level", async () => {
        const { registry, lines } = registryWithAProjection();

        await registry.dispatch(events, context);

        expect(atLevel(lines, ERROR)).toHaveLength(1);
        expect(atLevel(lines, WARN)).toHaveLength(0);
      });

      /** @scenario "Work discarded without a throw is logged at error" */
      it("does not blame initialize() alone, since close() clears the router too", async () => {
        const { registry, lines } = registryWithAProjection();

        await registry.dispatch(events, context);

        expect(atLevel(lines, ERROR)[0]?.msg).toContain("already closed");
      });
    });
  });

  describe("given nothing is registered at all", () => {
    describe("when events are dispatched", () => {
      /** @scenario "Work discarded without a throw is logged at error" */
      it("logs nothing, because there was no work to lose", async () => {
        const { logger, lines } = createTestLogger();
        const registry = new ProjectionRegistry({ logger, parseEvent: parseTestEvent });

        await registry.dispatch(events, context);

        expect(atLevel(lines, ERROR)).toHaveLength(0);
      });
    });
  });
});
