import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { type Event, EventSchema } from "../../domain/types.ts";
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

      expect([...(definition.eventSchemas?.keys() ?? [])]).toEqual([
        "test.started",
        "test.finished",
      ]);
      expect(definition.eventSchemas?.get("test.finished")).toBe(finishedSchema);
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
    it("keeps the open event type", () => {
      const builder = testPipeline().withEvents([]);

      expectTypeOf<PipelineEventOf<typeof builder>>().toEqualTypeOf<Event>();
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
