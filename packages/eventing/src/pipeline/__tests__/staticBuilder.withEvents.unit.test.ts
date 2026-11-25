import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { EventSchema } from "../../domain/types.ts";
import { definePipeline, type PipelineBuilder } from "../staticBuilder.ts";

const startedSchema = z.object({
  ...EventSchema.shape,
  type: z.literal("test.started"),
  data: z.object({ startedBy: z.string() }),
});
const finishedSchema = z.object({
  ...EventSchema.shape,
  type: z.literal("test.finished"),
  data: z.object({ outcome: z.enum(["passed", "failed"]) }),
});
type TestEvent = z.infer<typeof startedSchema> | z.infer<typeof finishedSchema>;
type PipelineEventOf<Builder> = Builder extends PipelineBuilder<infer E> ? E : never;

function testPipeline() {
  return definePipeline({ name: "with-events", aggregate: defineAggregate({ type: "test" }) });
}

describe("definePipeline(...).withEvents", () => {
  describe("when every event type has its contract schema", () => {
    it("indexes the schemas by type and lists the aggregate's events from them", () => {
      const definition = testPipeline().withEvents([startedSchema, finishedSchema]).build();

      expect([...(definition.eventSchemas.keys() ?? [])]).toEqual([
        "test.started",
        "test.finished",
      ]);
      expect(definition.eventSchemas.get("test.finished")).toBe(finishedSchema);
      expect(definition.aggregate.events.map((event) => event.type)).toEqual([
        "test.started",
        "test.finished",
      ]);
      expect(definition.metadata.allowedEventTypes).toEqual(["test.started", "test.finished"]);
    });

    it("infers the pipeline's event type from the schemas", () => {
      const builder = testPipeline().withEvents([startedSchema, finishedSchema]);

      expectTypeOf<PipelineEventOf<typeof builder>>().toEqualTypeOf<TestEvent>();
    });
  });

  describe("when a pipeline declares no events", () => {
    it("types its events as never, since none can be queued", () => {
      const builder = testPipeline().withEvents([]);

      expectTypeOf<PipelineEventOf<typeof builder>>().toEqualTypeOf<never>();
    });
  });

  describe("when a type is declared twice", () => {
    it("refuses at registration", () => {
      expect(() =>
        testPipeline().withEvents([startedSchema, finishedSchema, startedSchema]),
      ).toThrow(/declares event "test.started" more than once/);
    });
  });

  describe("when the events are not declared first", () => {
    it("offers nothing but withEvents before it and no second withEvents after it", () => {
      expectTypeOf(testPipeline()).not.toHaveProperty("build");
      expectTypeOf(testPipeline()).not.toHaveProperty("withCommand");
      expectTypeOf(testPipeline().withEvents([startedSchema])).not.toHaveProperty("withEvents");
    });
  });

  describe("when a schema is not a whole event", () => {
    it("is rejected by the compiler", () => {
      const bareSchema = z.object({ type: z.literal("other.happened"), data: z.object({}) });

      // @ts-expect-error a schema without the event envelope is not a pipeline event
      expect(() => testPipeline().withEvents([bareSchema])).not.toThrow();
    });
  });
});

describe("definePipeline's aggregate type", () => {
  describe("when the aggregate definition names its type", () => {
    /** @scenario An aggregate declares its type once */
    it("derives the pipeline's aggregate type from the definition and accepts no separate registration", () => {
      const definition = testPipeline().withEvents([startedSchema]).build();
      expect(definition.aggregate.type).toBe("test");
      expect(definition.metadata.aggregateType).toBe("test");

      const withSeparateType = definePipeline({
        name: "with-events",
        aggregate: defineAggregate({ type: "test" }),
        // @ts-expect-error the aggregate type is declared on the aggregate alone
        aggregateType: "other",
      })
        .withEvents([startedSchema])
        .build();
      expect(withSeparateType.metadata.aggregateType).toBe("test");
    });
  });
});
