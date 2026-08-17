/**
 * @vitest-environment node
 *
 * Dispatching with no router discards the events outright — nothing is thrown,
 * so no layer above will ever report the loss. That makes this the last place
 * it can be reported, which makes it an error however routine the code path
 * feels.
 *
 * It sat at warning instead, and the record blamed "before initialize()". In
 * prod it is overwhelmingly the opposite end: dispatches still in flight when
 * SIGTERM lands and `close()` has already cleared the router. 55 dropped
 * batches over the 48h to 2026-08-17, every one of them on a rolling deploy,
 * none of them alerted and all of them pointing at a boot race that was not
 * happening.
 *
 * Spec: specs/observability/retryable-failure-log-level.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import type { FoldProjectionDefinition } from "../foldProjection.types";
import { ProjectionRegistry } from "../projectionRegistry";

// `createLogger` hands back one instance per name, so every registry in this
// file shares a logger and a spy left in place would keep counting the next
// test's calls as its own.
afterEach(() => {
  vi.restoreAllMocks();
});

function registryWithAProjection() {
  const registry = new ProjectionRegistry();
  registry.registerFoldProjection({
    name: "any-fold",
  } as unknown as FoldProjectionDefinition<unknown, Event>);
  return registry;
}

function spyOnLogger(registry: ProjectionRegistry, level: "warn" | "error") {
  const logger = (registry as unknown as { logger: Record<string, unknown> })
    .logger;
  return vi.spyOn(logger as never, level as never) as ReturnType<
    typeof vi.spyOn
  >;
}

const events = [{ id: "event-1" }, { id: "event-2" }] as unknown as Event[];
const context = {} as never;

describe("dispatching to a projection registry with no router", () => {
  describe("given the router was never initialized or has been closed", () => {
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
    /** @scenario "A dispatch arriving after the router is gone is still reported" */
    it("states how many events were discarded", async () => {
      const registry = registryWithAProjection();
      const errorSpy = spyOnLogger(registry, "error");

      await registry.dispatch(events, context);

      expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({ eventCount: 2 });
    });

    /** @scenario "Work discarded without a throw is logged at error" */
    it("does not blame initialize() alone, since close() clears the router too", async () => {
      const registry = registryWithAProjection();
      const errorSpy = spyOnLogger(registry, "error");

      await registry.dispatch(events, context);

      expect(errorSpy.mock.calls[0]?.[1]).toContain("already closed");
    });
  });

  describe("given nothing is registered at all", () => {
    /** @scenario "Work discarded without a throw is logged at error" */
    it("logs nothing, because there was no work to lose", async () => {
      const registry = new ProjectionRegistry();
      const errorSpy = spyOnLogger(registry, "error");

      await registry.dispatch(events, context);

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
