/**
 * @vitest-environment node
 * The runtime's two boot seams: the maintenance pipelines it answers, and the
 * cross-pipeline projections a module's pipeline declares (ARCHITECTURE §9).
 */
import { describe, expect, it } from "vitest";

import { defineAggregate } from "../../domain/definitions.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types.ts";
import { ProjectionRegistry } from "../../projections/projectionRegistry.ts";

function eventlessPipeline(name: string) {
  return definePipeline({ name, aggregate: defineAggregate({ type: "global" }) }).withEvents([]);
}

const meter: MapProjectionDefinition<{ eventId: string }, Event> = {
  name: "everyEventMeter",
  eventTypes: ["lw.anything.happened"],
  map: (event) => ({ eventId: event.id }),
  store: { append: async () => void 0 },
};

describe("given a runtime built with maintenance pipelines", () => {
  it("answers them by name, and none when built without", () => {
    const eventSourcing = new EventSourcing({
      enabled: false,
      maintenance: () => [eventlessPipeline("blob_maintenance").build()],
    });

    expect(eventSourcing.maintenancePipelines().map((d) => d.metadata.name)).toEqual([
      "blob_maintenance",
    ]);
    expect(new EventSourcing({ enabled: false }).maintenancePipelines()).toEqual([]);
  });
});

describe("given a pipeline declaring a global map projection", () => {
  it("registers the projection and its subscribers onto the global registry", () => {
    const definition = eventlessPipeline("billing_reporting")
      .withGlobalMapProjection(meter, [{ name: "meterDispatch", handle: async () => void 0 }])
      .build();
    const registry = new ProjectionRegistry<Event>();

    for (const projection of definition.globalProjections ?? []) projection.register(registry);

    expect(definition.globalProjections?.map(({ name }) => name)).toEqual(["everyEventMeter"]);
    expect(registry.hasProjections).toBe(true);
  });

  it("refuses the same projection name twice", () => {
    expect(() =>
      eventlessPipeline("billing_reporting")
        .withGlobalMapProjection(meter)
        .withGlobalMapProjection(meter),
    ).toThrow(/everyEventMeter/);
  });
});
