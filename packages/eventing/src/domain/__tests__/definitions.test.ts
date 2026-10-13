import { describe, expect, it } from "vitest";

import { aggregateWithEvents, createEventCatalogue, defineAggregate } from "../definitions.ts";

describe("event catalogue", () => {
  /** @scenario "The application composes an explicit event catalogue" */
  it("registers aggregate-owned event types", () => {
    const traces = aggregateWithEvents({
      aggregate: defineAggregate({ type: "trace" }),
      eventTypes: ["lw.obs.trace.started", "lw.obs.trace.finished"],
    });
    const catalogue = createEventCatalogue([traces]);

    expect(catalogue.hasAggregate("trace")).toBe(true);
    expect(catalogue.hasEvent("lw.obs.trace.started")).toBe(true);
    expect(() => catalogue.assertEvent("trace", "lw.obs.trace.finished")).not.toThrow();
  });

  it("rejects duplicate aggregate types", () => {
    const first = aggregateWithEvents({
      aggregate: defineAggregate({ type: "trace" }),
      eventTypes: ["lw.obs.trace.started"],
    });
    const second = defineAggregate({ type: "trace" });

    expect(() => createEventCatalogue([first, second])).toThrow(
      'Aggregate type "trace" is registered twice',
    );
  });

  it("allows infrastructure-only pipelines to share an empty global aggregate", () => {
    const first = defineAggregate({ type: "global" });
    const second = defineAggregate({ type: "global" });

    expect(() => createEventCatalogue([first, second])).not.toThrow();
  });

  /** @scenario "Conflicting event definitions are rejected" */
  it("rejects an event type owned by multiple aggregates", () => {
    const traces = aggregateWithEvents({
      aggregate: defineAggregate({ type: "trace" }),
      eventTypes: ["lw.obs.shared.received"],
    });
    const logs = aggregateWithEvents({
      aggregate: defineAggregate({ type: "log" }),
      eventTypes: ["lw.obs.shared.received"],
    });

    expect(() => createEventCatalogue([traces, logs])).toThrow(
      'Event type "lw.obs.shared.received" belongs to both "trace" and "log"',
    );
  });

  it("rejects an event routed to the wrong aggregate", () => {
    const catalogue = createEventCatalogue([
      aggregateWithEvents({
        aggregate: defineAggregate({ type: "trace" }),
        eventTypes: ["lw.obs.trace.started"],
      }),
    ]);

    expect(() => catalogue.assertEvent("log", "lw.obs.trace.started")).toThrow(
      'Event type "lw.obs.trace.started" belongs to aggregate "trace", not "log"',
    );
  });
});
