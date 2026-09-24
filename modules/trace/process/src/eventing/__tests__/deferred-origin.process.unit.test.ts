import type { ProcessHandlerContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import type { DeferredOriginPayload } from "../../app/trace.members.ts";
import { TraceDeferredOriginEventingAdapter } from "../../services/eventing.deferred-origin.service.ts";
import {
  DEFERRED_ORIGIN_INITIAL_STATE,
  type DeferredOriginIntents,
  onOriginResolvedDisarm,
  onSpanReceivedArmOrigin,
} from "../deferred-origin.process.ts";

const NOW = 1_700_000_000_000;
function context(at: number): ProcessHandlerContext<DeferredOriginIntents> {
  return {
    at,
    now: NOW,
    key: "trace-1",
    projectId: "tenant-1",
    intents: {
      resolveDeferredOrigin: (key, payload) => ({
        messageKey: key,
        intentType: "resolveDeferredOrigin",
        payload,
      }),
    },
  };
}

describe("the deferredOriginResolution process manager", () => {
  describe("given a span arrives with no deadline armed", () => {
    it("arms the fallback five minutes out", () => {
      const evolution = onSpanReceivedArmOrigin(DEFERRED_ORIGIN_INITIAL_STATE, {}, context(NOW));
      expect(evolution.nextWakeAt).toBe(NOW + 5 * 60 * 1000);
    });
  });

  describe("given a deadline is already armed for the trace", () => {
    /** @scenario "Deferred check deduplicates per trace" */
    it("keeps the first deadline when later spans arrive", () => {
      const armed = { resolveAfterMs: NOW + 1_000 };
      const evolution = onSpanReceivedArmOrigin(armed, {}, context(NOW + 500));
      expect(evolution.state).toEqual(armed);
      expect(evolution.nextWakeAt).toBe(NOW + 1_000);
    });
  });

  describe("given the origin resolves", () => {
    it("disarms the fallback", () => {
      const evolution = onOriginResolvedDisarm({ resolveAfterMs: NOW }, {}, context(NOW));
      expect(evolution.nextWakeAt).toBeNull();
    });
  });
});

describe("TraceDeferredOriginEventingAdapter.createDeferredOriginHandler()", () => {
  describe("when called", () => {
    /** @scenario 'Deferred check treats still-empty origin as "application"' */
    it("dispatches resolveOrigin command unconditionally", async () => {
      const resolveOriginFn = vi.fn().mockResolvedValue(undefined);
      const handler =
        TraceDeferredOriginEventingAdapter.createDeferredOriginHandler(resolveOriginFn);
      const payload: DeferredOriginPayload = {
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      };

      await handler(payload);

      expect(resolveOriginFn).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        traceId: "trace-1",
        origin: "application",
        reason: "deferred_fallback",
        occurredAt: expect.any(Number),
      });
      // occurredAt should be the dispatch time (now), not the original trace time
      const calledOccurredAt = resolveOriginFn.mock.calls[0]![0].occurredAt;
      expect(calledOccurredAt).toBeGreaterThanOrEqual(Date.now() - 1000);
      expect(calledOccurredAt).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe("when resolveOrigin throws", () => {
    it("propagates the error", async () => {
      const resolveOriginFn = vi.fn().mockRejectedValue(new Error("command failed"));
      const handler =
        TraceDeferredOriginEventingAdapter.createDeferredOriginHandler(resolveOriginFn);
      const payload: DeferredOriginPayload = {
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      };

      await expect(handler(payload)).rejects.toThrow("command failed");
    });
  });
});
