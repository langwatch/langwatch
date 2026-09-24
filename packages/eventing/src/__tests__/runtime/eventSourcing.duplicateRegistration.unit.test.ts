/**
 * @vitest-environment node
 * Duplicate pipeline registration must fail at boot. Regression guard for
 * silent wrong-definition wins. {@link
 * modules/trace/specs/trace-processing-registration-ownership.feature}
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";

const recordedEventSchema = testEventSchema("trace.recorded", z.object({ note: z.string() }));

/**
 * Two definitions over one name, differing exactly the way the real pair does:
 * the draining one carries a subscriber, the producing one carries none.
 */
function definePipelineOverOneName(options: { withSubscriber: boolean }) {
  const pipeline = definePipeline({
    name: "trace_processing",
    aggregate: defineAggregate({
      type: "trace",
    }),
  }).withEvents([recordedEventSchema]);
  if (!options.withSubscriber) return pipeline.build();
  return pipeline
    .withEventSubscriber("recordedSpans", {
      events: ["trace.recorded"],
      handler: () => Promise.resolve(),
    })
    .build();
}

describe("given a pipeline name already registered on this runtime", () => {
  describe("when a second definition of that name registers", () => {
    /** @scenario "A second registration of one pipeline name refuses at boot" */
    it("refuses, rather than handing back the first registration", () => {
      const eventSourcing = new EventSourcing({ enabled: false });
      eventSourcing.register(definePipelineOverOneName({ withSubscriber: true }));

      expect(() =>
        eventSourcing.register(definePipelineOverOneName({ withSubscriber: false })),
      ).toThrow(/already registered/);
    });

    /** @scenario "The refusal names what each of the two registrations carries" */
    it("names the pipeline and describes both registrations", () => {
      const eventSourcing = new EventSourcing({ enabled: false });
      eventSourcing.register(definePipelineOverOneName({ withSubscriber: true }));

      let message = "";
      try {
        eventSourcing.register(definePipelineOverOneName({ withSubscriber: false }));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('Pipeline "trace_processing"');
      // The already-registered one drains; the refused one does not. Both
      // sides are described, so the failure says which composition to delete.
      expect(message).toContain("Already registered: ");
      expect(message).toContain("1 subscribers");
      expect(message).toContain("Refused: ");
      expect(message).toContain("0 subscribers");
    });

    /** @scenario "A refused registration leaves the first one intact" */
    it("keeps the first registration and adds no second definition", () => {
      const eventSourcing = new EventSourcing({ enabled: false });
      const first = eventSourcing.register(definePipelineOverOneName({ withSubscriber: true }));

      expect(() =>
        eventSourcing.register(definePipelineOverOneName({ withSubscriber: false })),
      ).toThrow();

      expect(eventSourcing.definitions).toHaveLength(1);
      expect(eventSourcing.getPipeline("trace_processing")).toBe(first);
    });
  });
});

describe("given two pipelines with different names", () => {
  describe("when both register on one runtime", () => {
    /** @scenario "Two differently named pipelines both register" */
    it("registers both", () => {
      const eventSourcing = new EventSourcing({ enabled: false });
      eventSourcing.register(definePipelineOverOneName({ withSubscriber: true }));
      eventSourcing.register(
        definePipeline({
          name: "trace_maintenance",
          aggregate: defineAggregate({
            type: "trace_maintenance_run",
          }),
        })
          .withEvents([testEventSchema("trace.maintained", z.object({}))])
          .build(),
      );

      expect(eventSourcing.definitions.map((definition) => definition.metadata.name)).toEqual([
        "trace_processing",
        "trace_maintenance",
      ]);
    });
  });
});
