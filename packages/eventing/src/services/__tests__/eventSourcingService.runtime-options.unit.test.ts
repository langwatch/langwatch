import { describe, expect, it } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import type { SubscriberDispatchDefinition } from "../../subscribers/subscriber.types";
import {
  createMockEventStore,
  createMockLogger,
  createMockMapProjectionDefinition,
} from "./testHelpers";

describe("EventSourcingService runtime warning policy", () => {
  const projectionSubscriber: SubscriberDispatchDefinition<Event> = {
    name: "test-projection-subscriber",
    handle: async () => {},
  };
  const eventSubscriber: EventSubscriberDefinition<Event> = {
    name: "test-event-subscriber",
    eventTypes: [],
    handle: async () => {},
  };

  function createService(options?: {
    warnWhenProjectionsRunInline?: boolean;
    eventSubscriberOnly?: boolean;
  }) {
    const logger = createMockLogger();
    new EventSourcingService<Event>({
      pipelineName: "test-pipeline",
      aggregateType: "trace",
      allowedEventTypes: ["test.event"],
      eventStore: createMockEventStore<Event>(),
      logger,
      mapProjections: options?.eventSubscriberOnly
        ? undefined
        : [createMockMapProjectionDefinition("test-map")],
      subscribers: options?.eventSubscriberOnly ? [eventSubscriber] : undefined,
      warnWhenProjectionsRunInline: options?.warnWhenProjectionsRunInline,
    });
    return logger;
  }

  it("does not infer a production warning without injected runtime policy", () => {
    expect(createService().warn).not.toHaveBeenCalled();
  });

  it("warns when process composition enables the inline-projection guard", () => {
    expect(createService({ warnWhenProjectionsRunInline: true }).warn).toHaveBeenCalledOnce();
  });

  it.each([
    ["fold", { foldSubscribers: [{ foldName: "test-fold", definition: projectionSubscriber }] }],
    ["map", { mapSubscribers: [{ mapName: "test-map", definition: projectionSubscriber }] }],
  ] as const)("warns for a %s subscriber without a shared queue", (_kind, subscribers) => {
    const logger = createMockLogger();

    expect(
      () =>
        new EventSourcingService<Event>({
          pipelineName: "test-pipeline",
          aggregateType: "trace",
          allowedEventTypes: ["test.event"],
          eventStore: createMockEventStore<Event>(),
          logger,
          warnWhenProjectionsRunInline: true,
          ...subscribers,
        }),
    ).toThrow("not found");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("warns for an event-only subscriber without a shared queue", () => {
    expect(
      createService({
        warnWhenProjectionsRunInline: true,
        eventSubscriberOnly: true,
      }).warn,
    ).toHaveBeenCalledOnce();
  });
});
