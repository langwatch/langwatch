import { describe, expect, it } from "vitest";
import {
  createEventCatalogue,
  defineAggregate,
  defineEvents,
} from "../definitions";

describe("event catalogue", () => {
  it("registers aggregate-owned event types", () => {
    const traces = defineAggregate({
      type: "trace",
      events: defineEvents([
        "lw.obs.trace.started",
        "lw.obs.trace.finished",
      ] as const),
    });
    const catalogue = createEventCatalogue([traces]);

    expect(catalogue.hasAggregate("trace")).toBe(true);
    expect(catalogue.hasEvent("lw.obs.trace.started")).toBe(true);
    expect(() =>
      catalogue.assertEvent("trace", "lw.obs.trace.finished"),
    ).not.toThrow();
  });

  it("rejects duplicate aggregate types", () => {
    const first = defineAggregate({
      type: "trace",
      events: defineEvents(["lw.obs.trace.started"] as const),
    });
    const second = defineAggregate({ type: "trace", events: [] });

    expect(() => createEventCatalogue([first, second])).toThrow(
      'Aggregate type "trace" is registered twice',
    );
  });

  it("allows infrastructure-only pipelines to share an empty global aggregate", () => {
    const first = defineAggregate({ type: "global", events: [] });
    const second = defineAggregate({ type: "global", events: [] });

    expect(() => createEventCatalogue([first, second])).not.toThrow();
  });

  it("rejects an event type owned by multiple aggregates", () => {
    const traces = defineAggregate({
      type: "trace",
      events: defineEvents(["lw.obs.shared.received"] as const),
    });
    const logs = defineAggregate({
      type: "log",
      events: defineEvents(["lw.obs.shared.received"] as const),
    });

    expect(() => createEventCatalogue([traces, logs])).toThrow(
      'Event type "lw.obs.shared.received" belongs to both "trace" and "log"',
    );
  });

  it("rejects an event routed to the wrong aggregate", () => {
    const catalogue = createEventCatalogue([
      defineAggregate({
        type: "trace",
        events: defineEvents(["lw.obs.trace.started"] as const),
      }),
    ]);

    expect(() =>
      catalogue.assertEvent("log", "lw.obs.trace.started"),
    ).toThrow(
      'Event type "lw.obs.trace.started" belongs to aggregate "trace", not "log"',
    );
  });
});
