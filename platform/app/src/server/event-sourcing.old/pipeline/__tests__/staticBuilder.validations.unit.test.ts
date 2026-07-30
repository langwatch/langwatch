import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import type { StateProjectionDefinition } from "../../projections/stateProjection.types";
import { createMockFoldProjectionDefinition } from "../../services/__tests__/testHelpers";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { definePipeline } from "../staticBuilder";

function createMockStateProjectionDefinition<E extends Event>(
  name: string,
): StateProjectionDefinition<Record<string, never>, E> {
  return {
    name,
    version: "2025-01-01",
    eventTypes: [],
    init: () => ({}),
    apply: (state) => state,
    store: {
      load: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("StaticPipelineBuilder validations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when fold projection with custom key is registered", () => {
    it("builds successfully", () => {
      const fold = {
        ...createMockFoldProjectionDefinition<Event>("withKey"),
        key: (event: Event) => String(event.tenantId),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("withKey", fold)
          .build(),
      ).not.toThrow();
    });
  });

  describe("when fold projection without custom key is registered", () => {
    it("builds successfully", () => {
      const fold = createMockFoldProjectionDefinition<Event>("simple");

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("simple", fold)
          .build(),
      ).not.toThrow();
    });
  });

  describe("when an event subscriber is registered", () => {
    it("stores the event-only definition without attaching it to a projection", () => {
      const subscriber: EventSubscriberDefinition<Event> = {
        name: "conversationProcess",
        eventTypes: [],
        handle: vi.fn(),
      };

      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventSubscriber("conversationProcess", subscriber)
        .build();

      expect(pipeline.eventSubscribers.get("conversationProcess")).toBe(
        subscriber,
      );
    });
  });

  describe("when a subscriber uses custom deduplication", () => {
    const event = {
      tenantId: "project-1",
      aggregateId: "trace-1",
    } as Event;

    /** @scenario "Custom deduplication uses provided ID function" */
    it("preserves the full deduplication contract as the definition authored it", () => {
      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventSubscriber("settle", {
          name: "settle",
          eventTypes: ["trace_received"],
          options: {
            deduplication: {
              makeId: (input) => `custom:${input.aggregateId}`,
              ttlMs: 12_000,
              extend: false,
              replace: false,
              shouldSurviveDispatch: true,
            },
          },
          handle: vi.fn(),
        })
        .build();

      const deduplication =
        pipeline.eventSubscribers.get("settle")?.options?.deduplication;
      expect(deduplication).toMatchObject({
        ttlMs: 12_000,
        extend: false,
        replace: false,
        shouldSurviveDispatch: true,
      });
      expect(
        deduplication === "aggregate"
          ? undefined
          : deduplication?.makeId(event),
      ).toBe("custom:trace-1");
    });
  });

  describe("when a default state projection is registered", () => {
    it("keeps it out of the fold and map projection registries", () => {
      const projection =
        createMockStateProjectionDefinition<Event>("conversationState");

      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("conversationState", projection)
        .build();

      expect(pipeline.stateProjections?.get("conversationState")).toBe(
        projection,
      );
      expect(pipeline.foldProjections.size).toBe(0);
      expect(pipeline.mapProjections.size).toBe(0);
    });
  });

  describe("when an event subscriber's mount name disagrees with its definition", () => {
    it("throws ConfigurationError rather than mounting it under two names", () => {
      const subscriber: EventSubscriberDefinition<Event> = {
        name: "graphTriggerActivity",
        eventTypes: [],
        handle: vi.fn(),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          // Kill-switch flag keys and dedup namespaces derive from the
          // subscriber name, so a mount that renames the definition would
          // silently split them in two.
          .withEventSubscriber("graphTriggerActivty", subscriber),
      ).toThrow(/name mismatch/);
    });
  });

  describe("when an event subscriber name is reused", () => {
    it("throws ConfigurationError", () => {
      const subscriber: EventSubscriberDefinition<Event> = {
        name: "conversationProcess",
        eventTypes: [],
        handle: vi.fn(),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventSubscriber("conversationProcess", subscriber)
          .withEventSubscriber("conversationProcess", subscriber),
      ).toThrow(/already exists/);
    });
  });
});
