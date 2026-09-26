import { createTestLogger, type TestLogLines } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type { Event } from "../../domain/types.ts";
import { sealMapProjection } from "../../projections/sealedProjection.ts";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types.ts";
import type { SubscriberDispatchDefinition } from "../../subscribers/subscriber.types.ts";
import { EventSourcingService } from "../eventSourcingService.ts";
import { createMockEventStore, createMockMapProjectionDefinition } from "./testHelpers.ts";

const warningsIn = (lines: TestLogLines) => lines.filter((line) => line.level === 40);

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
    const { logger, lines } = createTestLogger();
    new EventSourcingService<Event>({
      pipelineName: "test-pipeline",
      aggregateType: "trace",
      allowedEventTypes: ["test.event"],
      eventStore: createMockEventStore<Event>(),
      logger,
      mapProjections: options?.eventSubscriberOnly
        ? undefined
        : [sealMapProjection(createMockMapProjectionDefinition("test-map"))],
      subscribers: options?.eventSubscriberOnly ? [eventSubscriber] : undefined,
      warnWhenProjectionsRunInline: options?.warnWhenProjectionsRunInline,
    });
    return lines;
  }

  it("does not infer a production warning without injected runtime policy", () => {
    expect(warningsIn(createService())).toHaveLength(0);
  });

  it("warns when process composition enables the inline-projection guard", () => {
    expect(warningsIn(createService({ warnWhenProjectionsRunInline: true }))).toHaveLength(1);
  });

  it.each([
    ["fold", { foldSubscribers: [{ foldName: "test-fold", definition: projectionSubscriber }] }],
    ["map", { mapSubscribers: [{ mapName: "test-map", definition: projectionSubscriber }] }],
  ] as const)("warns for a %s subscriber without a shared queue", (_kind, subscribers) => {
    const { logger, lines } = createTestLogger();

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
    expect(warningsIn(lines)).toHaveLength(1);
  });

  it("warns for an event-only subscriber without a shared queue", () => {
    expect(
      warningsIn(
        createService({
          warnWhenProjectionsRunInline: true,
          eventSubscriberOnly: true,
        }),
      ),
    ).toHaveLength(1);
  });
});
