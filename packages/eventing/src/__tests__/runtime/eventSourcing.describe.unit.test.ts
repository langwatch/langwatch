/**
 * @vitest-environment node
 * Describing a pipeline lists it and nothing else: the api shows what the worker runs.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { EventSchema } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { createMockFoldProjectionStore } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const TYPE = "lw.test.described.happened";
const happened = z.object({ ...EventSchema.shape, type: z.literal(TYPE) });

describe("given a runtime that describes a pipeline", () => {
  it("lists it without claiming a queue, registering senders or running a process manager", () => {
    const queueFactory = vi.fn();
    const eventing = new EventSourcing({
      eventStore: EventStoreMemory.createForTesting(),
      queueFactory,
    });
    const definition = definePipeline({
      name: "described",
      aggregate: defineAggregate({ type: "described" }),
    })
      .withEvents([happened])
      .withClickHouseFoldProjection({
        name: "describedFold",
        version: "2026-01-01",
        eventTypes: [TYPE],
        init: () => ({}),
        apply: (state) => state,
        store: createMockFoldProjectionStore<object>(),
        LastEventOccurredAtKey: "lastEventOccurredAt",
      })
      .build();

    eventing.describe(definition);

    expect(eventing.definitions.map(({ metadata }) => metadata.name)).toEqual(["described"]);
    expect(queueFactory).not.toHaveBeenCalled();
    expect(() => eventing.getPipeline("described")).toThrow(/not found/);
    expect(eventing.unrunProcessManagers).toEqual([]);
  });
});
