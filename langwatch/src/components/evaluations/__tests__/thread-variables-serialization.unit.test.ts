/**
 * @vitest-environment node
 *
 * Unit tests for thread variable serialization/deserialization in OnlineEvaluationDrawer.
 * Feature: specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature
 *
 * These tests verify the serialization logic extracted from OnlineEvaluationDrawer
 * without requiring DOM or React rendering.
 */
import { describe, expect, it } from "vitest";
import {
  SERVER_ONLY_THREAD_SOURCES,
  THREAD_MAPPINGS,
  TRACE_MAPPINGS,
  type MappingState,
} from "~/server/tracer/tracesMapping";

// ---------------------------------------------------------------------------
// Helpers: extracted serialization/deserialization logic from OnlineEvaluationDrawer
// ---------------------------------------------------------------------------

type UIFieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };

/**
 * Serialize UI field mappings to MappingState format.
 * Mirrors the logic in OnlineEvaluationDrawer.handleSave.
 */
function serializeMappingsToMappingState(
  mappings: Record<string, UIFieldMapping>,
): MappingState {
  const mappingState: MappingState = {
    mapping: {},
    expansions: [],
  };

  for (const [field, mapping] of Object.entries(mappings)) {
    if (mapping.type === "source" && mapping.path.length > 0) {
      const parts = mapping.path;
      const source = parts[0]!;

      const isThreadSource =
        source in THREAD_MAPPINGS ||
        (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source) ||
        mapping.sourceId === "thread";

      if (isThreadSource) {
        const selectedFields =
          parts.length > 1 ? parts.slice(1) : undefined;
        mappingState.mapping[field] = {
          type: "thread" as const,
          source: source as keyof typeof THREAD_MAPPINGS,
          selectedFields,
        };
      } else {
        mappingState.mapping[field] = {
          source: source as keyof typeof TRACE_MAPPINGS,
          key: parts[1],
          subkey: parts[2],
        };
      }
    }
  }

  return mappingState;
}

/**
 * Deserialize MappingState to UI field mappings.
 * Mirrors the logic in OnlineEvaluationDrawer's monitor loading effect.
 */
function deserializeMappingStateToUI(
  existingMappings: MappingState,
  monitorLevel: "trace" | "thread",
): Record<string, UIFieldMapping> {
  const uiMappings: Record<string, UIFieldMapping> = {};

  for (const [field, mapping] of Object.entries(existingMappings.mapping)) {
    if (mapping.source) {
      const pathParts: string[] = [mapping.source as string];
      if ("type" in mapping && mapping.type === "thread") {
        if (
          "selectedFields" in mapping &&
          mapping.selectedFields?.length
        ) {
          pathParts.push(...mapping.selectedFields);
        }
      } else {
        if ("key" in mapping && mapping.key) pathParts.push(mapping.key);
        if ("subkey" in mapping && mapping.subkey)
          pathParts.push(mapping.subkey);
      }

      const isThreadMapping =
        "type" in mapping && mapping.type === "thread";
      const sourceId =
        monitorLevel === "thread"
          ? "thread"
          : isThreadMapping
            ? "thread"
            : "trace";

      uiMappings[field] = {
        type: "source",
        sourceId,
        path: pathParts,
      };
    }
  }

  return uiMappings;
}

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
