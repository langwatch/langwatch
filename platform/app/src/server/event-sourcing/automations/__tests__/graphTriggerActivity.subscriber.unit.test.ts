import { describe, expect, it, vi } from "vitest";
import {
  createGraphTriggerActivitySubscriber,
  GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
  graphTriggerActivityDedupId,
  type GraphTriggerActivityPorts,
  type TraceActivityEvent,
} from "../subscribers/graphTriggerActivity.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function event(overrides: Partial<TraceActivityEvent> = {}): TraceActivityEvent {
  return { type: "trace/committed", tenantId: "project-1", occurredAt: Date.now(), ...overrides };
}

function subscriberFor(ports: GraphTriggerActivityPorts) {
  return createGraphTriggerActivitySubscriber({ eventTypes: ["trace/committed"], ports });
}

describe("graph trigger activity subscriber", () => {
  describe("given the subscriber contract", () => {
    it("carries the 5s non-extending, non-replacing debounce window", () => {
      const subscriber = subscriberFor({
        getActiveGraphTriggers: vi.fn(),
        evaluateGraphTrigger: vi.fn(),
      });

      expect(subscriber.options?.delay).toBe(GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS);
      expect(subscriber.options?.deduplication?.ttlMs).toBe(GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS);
      expect(subscriber.options?.deduplication?.extend).toBe(false);
      expect(subscriber.options?.deduplication?.replace).toBe(false);
      expect(subscriber.options?.deduplication?.makeId(event())).toBe(
        "graph-trigger-activity:project-1",
      );
    });

    it("dedup id is keyed only on tenant, so a burst collapses to one evaluation per project", () => {
      expect(graphTriggerActivityDedupId(event({ tenantId: "a" }))).not.toBe(
        graphTriggerActivityDedupId(event({ tenantId: "b" })),
      );
    });
  });

  describe("given a project with active graph triggers", () => {
    it("evaluates every active trigger with a real-time reason", async () => {
      const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers: vi.fn().mockResolvedValue([{ id: "trigger-1" }, { id: "trigger-2" }]),
        evaluateGraphTrigger,
      };

      await subscriberFor(ports).handle(event(), { tenantId: "project-1" });

      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        tenantId: "project-1",
        reason: "real-time",
      });
      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trigger-2",
        tenantId: "project-1",
        reason: "real-time",
      });
    });
  });

  describe("given a project with no active graph triggers", () => {
    it("does nothing", async () => {
      const evaluateGraphTrigger = vi.fn();
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers: vi.fn().mockResolvedValue([]),
        evaluateGraphTrigger,
      };

      await subscriberFor(ports).handle(event(), { tenantId: "project-1" });

      expect(evaluateGraphTrigger).not.toHaveBeenCalled();
    });
  });

  describe("given a stale event past the age cutoff", () => {
    it("skips without evaluating any trigger", async () => {
      const getActiveGraphTriggers = vi.fn();
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers,
        evaluateGraphTrigger: vi.fn(),
      };

      await subscriberFor(ports).handle(
        event({ occurredAt: Date.now() - 60 * 60 * 1000 - 1 }),
        { tenantId: "project-1" },
      );

      expect(getActiveGraphTriggers).not.toHaveBeenCalled();
    });
  });

  describe("given one of several triggers fails to evaluate", () => {
    it("still evaluates the rest, then throws once so the whole job retries", async () => {
      const evaluateGraphTrigger = vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined);
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers: vi.fn().mockResolvedValue([{ id: "trigger-1" }, { id: "trigger-2" }]),
        evaluateGraphTrigger,
      };

      await expect(subscriberFor(ports).handle(event(), { tenantId: "project-1" })).rejects.toThrow(
        /1\/2 evaluations failed/,
      );

      expect(evaluateGraphTrigger).toHaveBeenCalledTimes(2);
    });
  });
});
