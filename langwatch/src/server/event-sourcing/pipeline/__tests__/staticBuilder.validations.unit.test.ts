import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import type { StateProjectionDefinition } from "../../projections/stateProjection.types";
import {
  createMockFoldProjectionDefinition,
  createMockMapProjectionDefinition,
} from "../../services/__tests__/testHelpers";
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
      const reactor: ReactorDefinition<Event> = {
        name: "shouldNotAttach",
        handle: vi.fn(),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withProjection("conversationState", projection)
          .withReactor(
            "conversationState" as never,
            "shouldNotAttach",
            reactor,
          ),
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

  describe("when reactor is registered on a fold projection", () => {
    it("stores reactor in foldReactors", () => {
      const fold = createMockFoldProjectionDefinition<Event>("myFold");
      const reactor: ReactorDefinition<Event> = {
        name: "myReactor",
        handle: vi.fn(),
      };

      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withFoldProjection("myFold", fold)
        .withReactor("myFold", "myReactor", reactor)
        .build();

      expect(pipeline.foldReactors.size).toBe(1);
      expect(pipeline.mapReactors.size).toBe(0);
      expect(pipeline.foldReactors.get("myReactor")?.projectionName).toBe(
        "myFold",
      );
    });
  });

  describe("when reactor is registered on a map projection", () => {
    it("stores reactor in mapReactors", () => {
      const mapProj = createMockMapProjectionDefinition<Event>("myMap");
      const reactor: ReactorDefinition<Event> = {
        name: "myReactor",
        handle: vi.fn(),
      };

      const pipeline = definePipeline<Event>()
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withMapProjection("myMap", mapProj)
        .withReactor("myMap", "myReactor", reactor)
        .build();

      expect(pipeline.mapReactors.size).toBe(1);
      expect(pipeline.foldReactors.size).toBe(0);
      expect(pipeline.mapReactors.get("myReactor")?.projectionName).toBe(
        "myMap",
      );
    });
  });

  describe("when reactor is registered on a non-existent projection", () => {
    it("throws ConfigurationError", () => {
      const fold = createMockFoldProjectionDefinition<Event>("myFold");
      const reactor: ReactorDefinition<Event> = {
        name: "myReactor",
        handle: vi.fn(),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("myFold", fold)
          .withReactor("myFold" as any, "myReactor", reactor)
          // Try to register on non-existent projection
          .withReactor("nonExistent" as any, "anotherReactor", reactor),
      ).toThrow(/projection not found/);
    });
  });

  describe("when duplicate reactor name is used", () => {
    it("throws ConfigurationError", () => {
      const fold = createMockFoldProjectionDefinition<Event>("myFold");
      const reactor1: ReactorDefinition<Event> = {
        name: "sameName",
        handle: vi.fn(),
      };
      const reactor2: ReactorDefinition<Event> = {
        name: "sameName",
        handle: vi.fn(),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("myFold", fold)
          .withReactor("myFold", "sameName", reactor1)
          .withReactor("myFold", "sameName", reactor2),
      ).toThrow(/already exists/);
    });
  });


});
