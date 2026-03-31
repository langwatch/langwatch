/**
 * @vitest-environment node
 *
 * Unit tests for thread variable serialization/deserialization.
 * Feature: specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature
 *
 * Tests the real serializeMappingsToMappingState and deserializeMappingStateToUI
 * functions from the shared mappingSerialization module.
 */
import { describe, expect, it } from "vitest";
import type { MappingState } from "~/server/tracer/tracesMapping";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import { serializeMappingsToMappingState } from "../utils/serializeMappingsToMappingState";
import { deserializeMappingStateToUI } from "../utils/deserializeMappingStateToUI";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: Thread variables available in trace-level evaluator input mapping", () => {
  // -------------------------------------------------------------------------
  // @unit Scenario: Serialization marks thread sources with type "thread" including SERVER_ONLY_THREAD_SOURCES
  // -------------------------------------------------------------------------
  describe("serializeMappingsToMappingState()", () => {
    describe("given a trace-level evaluator with 'conversation' mapped to 'thread.formatted_traces'", () => {
      describe("when the mapping is serialized to MappingState", () => {
        it("marks the 'conversation' entry with type 'thread' and source 'formatted_traces'", () => {
          const uiMappings: Record<string, UIFieldMapping> = {
            conversation: {
              type: "source",
              sourceId: "thread",
              path: ["formatted_traces"],
            },
          };

          const result = serializeMappingsToMappingState(uiMappings);

          const conversationMapping = result.mapping.conversation!;
          expect("type" in conversationMapping).toBe(true);
          expect(
            (conversationMapping as { type: string }).type,
          ).toBe("thread");
          expect(
            (conversationMapping as { source: string }).source,
          ).toBe("formatted_traces");
        });
      });
    });

    describe("given a mixed trace and thread mapping", () => {
      it("serializes trace source without type and thread source with type 'thread'", () => {
        const uiMappings: Record<string, UIFieldMapping> = {
          input: {
            type: "source",
            sourceId: "trace",
            path: ["input"],
          },
          conversation: {
            type: "source",
            sourceId: "thread",
            path: ["formatted_traces"],
          },
        };

        const result = serializeMappingsToMappingState(uiMappings);

        // Trace mapping should NOT have type "thread"
        const inputMapping = result.mapping.input!;
        expect("type" in inputMapping && inputMapping.type === "thread").toBe(
          false,
        );
        expect((inputMapping as { source: string }).source).toBe("input");

        // Thread mapping should have type "thread"
        const conversationMapping = result.mapping.conversation!;
        expect(
          "type" in conversationMapping &&
            conversationMapping.type === "thread",
        ).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // @unit Scenario: Deserialization assigns sourceId "thread" for thread-typed mappings at trace level
  // -------------------------------------------------------------------------
  describe("deserializeMappingStateToUI()", () => {
    describe("given a saved trace-level monitor with a thread-typed mapping for 'conversation'", () => {
      describe("when the mapping is deserialized for the UI", () => {
        it("assigns sourceId 'thread' to the 'conversation' field", () => {
          const savedMappings: MappingState = {
            mapping: {
              input: { source: "input" },
              conversation: {
                type: "thread",
                source: "formatted_traces",
              },
            },
            expansions: [],
          };

          const result = deserializeMappingStateToUI(savedMappings, "trace");

          expect(result.conversation!.type).toBe("source");
          expect(
            (result.conversation as { sourceId: string }).sourceId,
          ).toBe("thread");
        });

        it("correctly reconstructs the thread source and selectedFields in the path", () => {
          const savedMappings: MappingState = {
            mapping: {
              history: {
                type: "thread",
                source: "traces",
                selectedFields: ["input", "output"],
              },
            },
            expansions: [],
          };

          const result = deserializeMappingStateToUI(savedMappings, "trace");

          expect(result.history!.type).toBe("source");
          expect((result.history as { sourceId: string }).sourceId).toBe(
            "thread",
          );
          expect((result.history as { path: string[] }).path).toEqual([
            "traces",
            "input",
            "output",
          ]);
        });

        it("assigns sourceId 'trace' to trace-sourced fields at trace level", () => {
          const savedMappings: MappingState = {
            mapping: {
              input: { source: "input" },
            },
            expansions: [],
          };

          const result = deserializeMappingStateToUI(savedMappings, "trace");

          expect(
            (result.input as { sourceId: string }).sourceId,
          ).toBe("trace");
        });
      });
    });
  });
});
