/**
 * @vitest-environment jsdom
 *
 * Regression coverage for useTargetOutputs falling back to the target's own
 * schema-less output copy when the prompt lookup it was reaching for resolves
 * with no data (deleted prompt, fetch error, project mismatch). Returning
 * that known-invalid copy silently re-introduces the bug this hook exists to
 * route around: a lone `json_schema`-typed output with no schema means the
 * comparison field picker resolves to an empty candidate at execution time.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TargetConfig } from "../../types";

let mockQueryResults: Array<{ data: unknown; isLoading: boolean }> = [];

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: () => mockQueryResults,
  },
}));

import { useTargetOutputs } from "../useTargetOutputs";

const promptTarget = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: `prompt-${id}`,
  inputs: [{ identifier: "input", type: "str" }],
  // The known-invalid shape: claims json_schema but carries no schema.
  outputs: [{ identifier: "output", type: "json_schema" }],
  mappings: {},
});

describe("useTargetOutputs", () => {
  describe("given a target whose own outputs already carry a schema", () => {
    it("returns the target's own outputs without querying the prompt", () => {
      mockQueryResults = [{ data: undefined, isLoading: false }];
      const target: TargetConfig = {
        id: "t1",
        type: "prompt",
        promptId: "prompt-1",
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      };

      const { result } = renderHook(() => useTargetOutputs([target]));

      expect(result.current[0]).toBe(target.outputs);
    });
  });

  describe("given a target with an unsaved local prompt draft", () => {
    it("prefers the draft's outputs over the target's saved copy", () => {
      // Clicking "Apply" in the prompt editor only writes to
      // localPromptConfig — target.outputs is untouched until a real
      // prompt "Save"/"Update to v2". The field picker must reflect the
      // draft immediately, or a just-applied JSON schema edit is invisible
      // until the prompt is saved as a new version.
      mockQueryResults = [{ data: undefined, isLoading: false }];
      const draftOutputs = [
        {
          identifier: "output",
          type: "json_schema" as const,
          json_schema: {
            type: "object",
            properties: {
              document_type: { type: "string" },
              confidence: { type: "number" },
            },
          },
        },
      ];
      const target: TargetConfig = {
        id: "t1",
        type: "prompt",
        promptId: "prompt-1",
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        localPromptConfig: {
          llm: { model: "openai/gpt-5-mini" },
          messages: [],
          inputs: [],
          outputs: draftOutputs,
        },
      };

      const { result } = renderHook(() => useTargetOutputs([target]));

      expect(result.current[0]).toEqual(draftOutputs);
    });

    it("falls back to the target's own outputs when the draft has no outputs yet", () => {
      mockQueryResults = [{ data: undefined, isLoading: false }];
      const target: TargetConfig = {
        id: "t1",
        type: "prompt",
        promptId: "prompt-1",
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        localPromptConfig: {
          llm: { model: "openai/gpt-5-mini" },
          messages: [],
          inputs: [],
          outputs: [],
        },
      };

      const { result } = renderHook(() => useTargetOutputs([target]));

      expect(result.current[0]).toBe(target.outputs);
    });
  });

  describe("given a schema-less output and the prompt query is still loading", () => {
    it("returns undefined instead of the schema-less copy", () => {
      mockQueryResults = [{ data: undefined, isLoading: true }];
      const target = promptTarget("t1");

      const { result } = renderHook(() => useTargetOutputs([target]));

      expect(result.current[0]).toBeUndefined();
    });
  });

  describe("given a schema-less output and the prompt query resolves with outputs", () => {
    it("returns the prompt's outputs", () => {
      const resolvedOutputs = [
        { identifier: "output", type: "json_schema", json_schema: { type: "object" } },
      ];
      mockQueryResults = [
        { data: { outputs: resolvedOutputs }, isLoading: false },
      ];
      const target = promptTarget("t1");

      const { result } = renderHook(() => useTargetOutputs([target]));

      expect(result.current[0]).toBe(resolvedOutputs);
    });
  });

  describe("given a schema-less output and the prompt query resolves with no data", () => {
    it("does not fall back to the known-invalid schema-less copy", () => {
      // Deleted prompt, fetch error, or a stale promptId — the query settles
      // with nothing to offer instead of the target's own broken copy.
      mockQueryResults = [{ data: undefined, isLoading: false }];
      const target = promptTarget("t1");

      const { result } = renderHook(() => useTargetOutputs([target]));

      expect(result.current[0]).toBeUndefined();
    });
  });
});
