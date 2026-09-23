/**
 * @vitest-environment node
 * Dropped dispatches log as error since this is the last place to report loss.
 * See specs/observability/retryable-failure-log-level.feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMockFoldProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
} from "../../services/__tests__/testHelpers.ts";
import { ProjectionRegistry } from "../projectionRegistry.ts";

// `createLogger` hands back one instance per name, so every registry in this
// file shares a logger and a spy left in place would keep counting the next
// test's calls as its own.
afterEach(() => {
  vi.restoreAllMocks();
});

function registryWithAProjection() {
  const registry = new ProjectionRegistry();
  registry.registerFoldProjection(createMockFoldProjectionDefinition("any-fold"));
  return registry;
}

/**
 * A registry that had a router and then lost it to `close()` — the prod case
 * the bound scenario names. Seeding the router directly keeps this a unit
 * test, since `initialize()` needs a live queue processor and job registry.
 */
async function registryClosedAfterRouting() {
  const registry = registryWithAProjection();
  (registry as unknown as { router: unknown }).router = {
    routeEvents: async () => undefined,
  };
  await registry.close();
  return registry;
}

function spyOnLogger(registry: ProjectionRegistry, level: "warn" | "error") {
  const logger = (registry as unknown as { logger: Record<string, unknown> }).logger;
  return vi.spyOn(logger as never, level as never) as ReturnType<typeof vi.spyOn>;
}

const events = [
  createTestEvent("aggregate-1", createTestAggregateType(), createTestTenantId()),
  createTestEvent("aggregate-2", createTestAggregateType(), createTestTenantId()),
];
const context = {} as never;

describe("dispatching to a projection registry with no router", () => {
  describe("given close() has cleared a router that was there", () => {
    describe("when events are dispatched afterwards", () => {
      /** @scenario "Dropping events after the projection router is gone is an error" */
      /** @scenario "A dispatch arriving after the router is gone is still reported" */
      it("logs at error level", async () => {
        const registry = await registryClosedAfterRouting();
        const errorSpy = spyOnLogger(registry, "error");
        const warnSpy = spyOnLogger(registry, "warn");

        await registry.dispatch(events, context);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
      });

      /** @scenario "Work discarded without a throw is logged at error" */
      /** @scenario "A dispatch arriving after the router is gone is still reported" */
      it("states how many events were discarded", async () => {
        const registry = await registryClosedAfterRouting();
        const errorSpy = spyOnLogger(registry, "error");

        await registry.dispatch(events, context);

        expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({ eventCount: 2 });
      });

      /** @scenario "A dispatch arriving after the router is gone is still reported" */
      it("does not blame initialize() alone, since close() clears the router too", async () => {
        const registry = await registryClosedAfterRouting();
        const errorSpy = spyOnLogger(registry, "error");

        await registry.dispatch(events, context);

        expect(errorSpy.mock.calls[0]?.[1]).toContain("already closed");
      });
    });
  });

  describe("given the router was never initialized", () => {
    describe("when events are dispatched", () => {
      /** @scenario "Dropping events after the projection router is gone is an error" */
      it("logs at error level", async () => {
        const registry = registryWithAProjection();
        const errorSpy = spyOnLogger(registry, "error");
        const warnSpy = spyOnLogger(registry, "warn");

        await registry.dispatch(events, context);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
      });

      /** @scenario "Work discarded without a throw is logged at error" */
      it("does not blame initialize() alone, since close() clears the router too", async () => {
        const registry = registryWithAProjection();
        const errorSpy = spyOnLogger(registry, "error");

        await registry.dispatch(events, context);

        expect(errorSpy.mock.calls[0]?.[1]).toContain("already closed");
      });
    });
  });

  describe("given nothing is registered at all", () => {
    describe("when events are dispatched", () => {
      /** @scenario "Work discarded without a throw is logged at error" */
      it("logs nothing, because there was no work to lose", async () => {
        const registry = new ProjectionRegistry();
        const errorSpy = spyOnLogger(registry, "error");

        await registry.dispatch(events, context);

        expect(errorSpy).not.toHaveBeenCalled();
      });
    });
  });
});
