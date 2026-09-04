/**
 * The round trip between the mapping UI's field mappings and the `MappingState`
 * a monitor stores, for the mixed trace + thread case.
 *
 * A trace-level evaluator may map a field to a THREAD source, so the type each
 * side stamps is what keeps the server resolving the field against the thread
 * rather than against the one trace that triggered the run.
 *
 * See specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature.
 */
import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-web/surfaces/variables";
import { SERVER_ONLY_THREAD_SOURCES } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { deserializeMappingStateToUI } from "../deserialize-mapping-state-to-ui";
import { serializeMappingsToMappingState } from "../serialize-mappings-to-mapping-state";

describe("the evaluator mapping round trip", () => {
  describe("given a trace-level evaluator mapping a field to a thread source", () => {
    /** @scenario Serialization marks thread sources with type "thread" including SERVER_ONLY_THREAD_SOURCES */
    it("stamps the stored entry as a thread source", () => {
      const mappings: Record<string, UIFieldMapping> = {
        conversation: {
          type: "source",
          sourceId: "thread",
          path: ["formatted_traces"],
        },
        input: { type: "source", sourceId: "trace", path: ["input"] },
      };

      const state = serializeMappingsToMappingState(mappings);

      expect(SERVER_ONLY_THREAD_SOURCES).toContain("formatted_traces");
      expect(state.mapping.conversation).toMatchObject({
        type: "thread",
        source: "formatted_traces",
      });
      expect(state.mapping.input).toMatchObject({ source: "input" });
      expect(state.mapping.input).not.toHaveProperty("type", "thread");
    });
  });

  describe("given a saved trace-level monitor carrying a thread-typed mapping", () => {
    /** @scenario Deserialization assigns sourceId "thread" for thread-typed mappings at trace level */
    it("reads it back under the thread source, with its selected fields", () => {
      const uiMappings = deserializeMappingStateToUI(
        {
          mapping: {
            conversation: {
              type: "thread",
              source: "traces",
              selectedFields: ["input", "output"],
            },
            input: { source: "input" },
          },
          expansions: [],
        } as never,
        "trace",
      );

      expect(uiMappings.conversation).toEqual({
        type: "source",
        sourceId: "thread",
        path: ["traces", "input", "output"],
      });
      expect(uiMappings.input).toEqual({
        type: "source",
        sourceId: "trace",
        path: ["input"],
      });
    });
  });
});
