import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineAggregate, defineEvents } from "../../domain/definitions.ts";
import { EventSchema } from "../../domain/types.ts";
import { definePipeline } from "../staticBuilder.ts";
import type { StaticPipelineDefinition } from "../staticBuilder.types.ts";

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

function testPipeline(events: readonly string[] = []) {
  return definePipeline<TestEvent>({
    name: "with-events",
    aggregate: defineAggregate({ type: "test", events: defineEvents(events) }),
  });
}

describe("PipelineBuilder.withEvents", () => {
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
      expectTypeOf(definition).toExtend<StaticPipelineDefinition<TestEvent>>();
    });
  });

  describe("when the aggregate still lists the same types", () => {
    it("builds", () => {
      const definition = testPipeline(["test.finished", "test.started"])
        .withEvents([startedSchema, finishedSchema])
        .build();

      expect(definition.aggregate.events).toHaveLength(2);
    });
  });

  describe("when the aggregate lists a type no schema declares", () => {
    it("refuses at build", () => {
      const builder = testPipeline(["test.started", "test.cancelled"]).withEvents([
        startedSchema,
        finishedSchema,
      ]);

      expect(() => builder.build()).toThrow(/lists events its \.withEvents schemas do not declare/);
    });
  });

  describe("when a type is declared twice", () => {
    it("refuses at registration", () => {
      expect(() =>
        testPipeline().withEvents([startedSchema, finishedSchema, startedSchema]),
      ).toThrow(/declares event "test.started" more than once/);
    });
  });

  describe("when events are declared twice", () => {
    it("refuses at registration", () => {
      const builder = testPipeline().withEvents([startedSchema, finishedSchema]);

      expect(() => builder.withEvents([startedSchema, finishedSchema])).toThrow(
        /declares its events twice/,
      );
    });
  });

  describe("when a pipeline event type has no schema", () => {
    it("is rejected by the compiler", () => {
      // @ts-expect-error test.finished is undeclared
      expect(() => testPipeline().withEvents([startedSchema])).not.toThrow();
    });
  });

  describe("when a schema's event is not the pipeline's", () => {
    it("is rejected by the compiler", () => {
      const foreignSchema = z.object({
        ...EventSchema.shape,
        type: z.literal("other.happened"),
        data: z.object({}),
      });

      expect(() =>
        // @ts-expect-error other.happened is not a TestEvent
        testPipeline().withEvents([startedSchema, finishedSchema, foreignSchema]),
      ).not.toThrow();
    });
  });
});
