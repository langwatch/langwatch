import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import type { StateProjectionDefinition } from "../../projections/stateProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  createMockFoldProjectionDefinition,
  createMockMapProjectionDefinition,
} from "../../services/__tests__/testHelpers";
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
      expect(pipeline.foldReactors.size).toBe(0);
      expect(pipeline.mapReactors.size).toBe(0);
    });
  });

  describe("when a subscriber uses custom deduplication", () => {
    const event = {
      tenantId: "project-1",
      aggregateId: "trace-1",
    } as Event;

    it("preserves the full deduplication contract on a fold subscriber", () => {
      const fold = createMockFoldProjectionDefinition<Event>("summary");
      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withFoldProjection("summary", fold)
        .withSubscriber("settle", {
          fold: "summary",
          dedup: {
            makeId: (input) => `custom:${input.aggregateId}`,
            ttlMs: 12_000,
            extend: false,
            replace: false,
            shouldSurviveDispatch: true,
          },
          handler: vi.fn(),
        })
        .build();

      const deduplication =
        pipeline.foldReactors.get("settle")?.definition.options?.deduplication;
      expect(deduplication).toMatchObject({
        ttlMs: 12_000,
        extend: false,
        replace: false,
        shouldSurviveDispatch: true,
      });
      expect(deduplication?.makeId({ event, foldState: {} })).toBe(
        "subscriber:settle:custom:trace-1",
      );
    });

    it("threads a custom groupKeyFn through to the raw subscriber definition", () => {
      // Without the pass-through, a subscriber spec's groupKeyFn silently
      // vanished and the queue fell back to per-aggregate groups — the gap
      // behind the 2026-07-31 parallel sweep storm (dedup bounded staging,
      // nothing bounded concurrency).
      const laneFn = (e: Event) => `lane:${e.tenantId}`;
      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withSubscriber("settle", {
          events: ["trace_received"],
          groupKeyFn: laneFn,
          handler: vi.fn(),
        })
        .build();

      const options = pipeline.eventSubscribers.get("settle")?.options;
      expect(options?.groupKeyFn).toBe(laneFn);
      expect(options?.groupKeyFn?.(event)).toBe("lane:project-1");
    });

    it("adapts a custom groupKeyFn onto a fold subscriber's reactor payload", () => {
      // Fold/map subscribers dispatch with a { event, foldState } payload;
      // the spec's event-shaped key must be adapted, not silently dropped —
      // dropping it recreates the raw-subscriber gap on the reactor path.
      const laneFn = (e: Event) => `lane:${e.tenantId}`;
      const fold = createMockFoldProjectionDefinition<Event>("summary");
      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withFoldProjection("summary", fold)
        .withSubscriber("settle", {
          fold: "summary",
          events: ["trace_received"],
          groupKeyFn: laneFn,
          handler: vi.fn(),
        })
        .build();

      const reactorGroupKeyFn =
        pipeline.foldReactors?.get("settle")?.definition.options?.groupKeyFn;
      expect(reactorGroupKeyFn?.({ event, foldState: {} })).toBe(
        "lane:project-1",
      );
    });

    it("preserves the full deduplication contract on a raw subscriber", () => {
      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withSubscriber("settle", {
          events: ["trace_received"],
          dedup: {
            makeId: (input) => `custom:${input.aggregateId}`,
            ttlMs: 12_000,
            extend: false,
            replace: false,
            shouldSurviveDispatch: true,
          },
          handler: vi.fn(),
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
    it("keeps it out of the legacy fold and reactor registries", () => {
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
      expect(pipeline.foldReactors.size).toBe(0);
      expect(pipeline.mapReactors.size).toBe(0);
    });

    it("cannot be used as a reactor parent", () => {
      const projection =
        createMockStateProjectionDefinition<Event>("conversationState");
      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withProjection("conversationState", projection)
          .withSubscriber("shouldNotAttach", {
            fold: "conversationState" as never,
            handler: vi.fn(),
          }),
      ).toThrow(/projection not found/);
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

  describe("when a subscriber is registered on a fold projection", () => {
    it("stores the registration in foldReactors", () => {
      const fold = createMockFoldProjectionDefinition<Event>("myFold");

      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withFoldProjection("myFold", fold)
        .withSubscriber("mySubscriber", {
          fold: "myFold" as never,
          handler: vi.fn(),
        })
        .build();

      expect(pipeline.foldReactors.size).toBe(1);
      expect(pipeline.mapReactors.size).toBe(0);
      expect(pipeline.foldReactors.get("mySubscriber")?.projectionName).toBe(
        "myFold",
      );
    });
  });

  describe("when a subscriber is registered on a map projection", () => {
    it("stores the registration in mapReactors", () => {
      const mapProj = createMockMapProjectionDefinition<Event>("myMap");

      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withMapProjection("myMap", mapProj)
        .withSubscriber("mySubscriber", {
          map: "myMap",
          handler: vi.fn(),
        })
        .build();

      expect(pipeline.mapReactors.size).toBe(1);
      expect(pipeline.foldReactors.size).toBe(0);
      expect(pipeline.mapReactors.get("mySubscriber")?.projectionName).toBe(
        "myMap",
      );
    });
  });

  describe("when a subscriber is registered on a non-existent projection", () => {
    it("throws ConfigurationError", () => {
      const fold = createMockFoldProjectionDefinition<Event>("myFold");

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("myFold", fold)
          .withSubscriber("mySubscriber", {
            fold: "myFold" as never,
            handler: vi.fn(),
          })
          // Try to register on non-existent projection
          .withSubscriber("anotherSubscriber", {
            fold: "nonExistent" as never,
            handler: vi.fn(),
          }),
      ).toThrow(/projection not found/);
    });
  });

  describe("when a duplicate subscriber name is used", () => {
    it("throws ConfigurationError", () => {
      const fold = createMockFoldProjectionDefinition<Event>("myFold");

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("myFold", fold)
          .withSubscriber("sameName", {
            fold: "myFold" as never,
            handler: vi.fn(),
          })
          .withSubscriber("sameName", {
            fold: "myFold" as never,
            handler: vi.fn(),
          }),
      ).toThrow(/already exists/);
    });
  });
});
