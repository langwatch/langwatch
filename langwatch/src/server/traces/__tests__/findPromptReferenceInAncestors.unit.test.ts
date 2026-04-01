import { describe, it, expect } from "vitest";
import {
  findPromptReferenceInAncestors,
  flattenParamsToPromptAttributes,
} from "../findPromptReferenceInAncestors";

describe("findPromptReferenceInAncestors()", () => {
  describe("when prompt ref is on immediate parent", () => {
    it("returns the parent's prompt reference", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.id": "team/sample-prompt:3",
            "langwatch.prompt.variables":
              '{"type":"json","value":{"name":"Alice"}}',
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "team/sample-prompt",
        promptVersionNumber: 3,
        promptVariables: { name: "Alice" },
      });
    });
  });

  describe("when prompt ref is on grandparent", () => {
    it("walks up two levels to find the reference", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "middle-span",
          startTime: 300,
          attributes: {},
        },
        {
          spanId: "middle-span",
          parentSpanId: "grandparent-span",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "grandparent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.id": "org/deep-prompt:7",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "org/deep-prompt",
        promptVersionNumber: 7,
        promptVariables: null,
      });
    });
  });

  describe("when prompt ref is on a sibling span", () => {
    it("finds the sibling's prompt reference", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 300,
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
        {
          spanId: "sibling-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {
            "langwatch.prompt.id": "team/sibling-prompt:1",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "team/sibling-prompt",
        promptVersionNumber: 1,
        promptVariables: null,
      });
    });
  });

  describe("when prompt ref is on a sibling of a grandparent (cousin)", () => {
    it("walks up to find the cousin's prompt reference", () => {
      // root
      // ├── PromptApiService.get  (has prompt ref, startTime=110)
      // ├── Prompt.compile        (has prompt ref, startTime=120)
      // └── agent_call            (startTime=130)
      //     └── subtask           (startTime=140)
      //         └── llm           (startTime=150) ← target
      const spans = [
        {
          spanId: "root",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
        {
          spanId: "prompt-api-get",
          parentSpanId: "root",
          startTime: 110,
          attributes: {
            "langwatch.prompt.id": "team/api-prompt:1",
          },
        },
        {
          spanId: "prompt-compile",
          parentSpanId: "root",
          startTime: 120,
          attributes: {
            "langwatch.prompt.id": "team/compiled-prompt:2",
          },
        },
        {
          spanId: "agent-call",
          parentSpanId: "root",
          startTime: 130,
          attributes: {},
        },
        {
          spanId: "subtask",
          parentSpanId: "agent-call",
          startTime: 140,
          attributes: {},
        },
        {
          spanId: "llm-span",
          parentSpanId: "subtask",
          startTime: 150,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      // Prompt.compile started later (closer in time) than PromptApiService.get
      expect(result).toEqual({
        promptHandle: "team/compiled-prompt",
        promptVersionNumber: 2,
        promptVariables: null,
      });
    });
  });

  describe("when multiple sibling spans have prompt refs", () => {
    it("picks the one with the latest startTime (closest preceding)", () => {
      const spans = [
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
        {
          spanId: "early-sibling",
          parentSpanId: "parent-span",
          startTime: 150,
          attributes: {
            "langwatch.prompt.id": "team/early-prompt:1",
          },
        },
        {
          spanId: "late-sibling",
          parentSpanId: "parent-span",
          startTime: 250,
          attributes: {
            "langwatch.prompt.id": "team/late-prompt:2",
          },
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 300,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "team/late-prompt",
        promptVersionNumber: 2,
        promptVariables: null,
      });
    });
  });

  describe("when prompt ref sibling started AFTER the LLM span", () => {
    it("ignores the sibling and returns null", () => {
      const spans = [
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "later-sibling",
          parentSpanId: "parent-span",
          startTime: 300,
          attributes: {
            "langwatch.prompt.id": "team/later-prompt:1",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toBeNull();
    });
  });

  describe("when parent itself has prompt ref and siblings also do", () => {
    it("prefers the parent's prompt ref over siblings", () => {
      // At the first ancestor level (the parent), the parent itself has a prompt ref.
      // The function should check the parent itself first (existing behavior)
      // before looking at siblings.
      const spans = [
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.id": "team/parent-prompt:5",
          },
        },
        {
          spanId: "sibling-span",
          parentSpanId: "parent-span",
          startTime: 150,
          attributes: {
            "langwatch.prompt.id": "team/sibling-prompt:1",
          },
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      // The sibling is closer in the hierarchy (same parent), so it's preferred
      expect(result).toEqual({
        promptHandle: "team/sibling-prompt",
        promptVersionNumber: 1,
        promptVariables: null,
      });
    });
  });

  describe("when no ancestor or sibling has a prompt reference", () => {
    it("returns null", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toBeNull();
    });
  });

  describe("when target span itself has a prompt reference", () => {
    it("skips the target span (already checked separately)", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.id": "team/on-self:5",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toBeNull();
    });
  });

  describe("when old separate format is on parent", () => {
    it("finds the reference using the old format", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.handle": "team/old-prompt",
            "langwatch.prompt.version.number": "2",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "team/old-prompt",
        promptVersionNumber: 2,
        promptVariables: null,
      });
    });
  });

  describe("when nearest ancestor with ref is preferred over farther one", () => {
    it("returns the nearest ancestor's reference", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 300,
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: "grandparent-span",
          startTime: 200,
          attributes: {
            "langwatch.prompt.id": "team/nearest:2",
          },
        },
        {
          spanId: "grandparent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.id": "team/farther:1",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "team/nearest",
        promptVersionNumber: 2,
        promptVariables: null,
      });
    });
  });

  describe("when parent chain has a self-cycle", () => {
    it("breaks out instead of looping forever", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: "parent-span", // points to itself
          startTime: 100,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toBeNull();
    });
  });

  describe("when parent chain has a two-node cycle", () => {
    it("breaks out instead of looping forever", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "span-a",
          startTime: 300,
          attributes: {},
        },
        {
          spanId: "span-a",
          parentSpanId: "span-b",
          startTime: 200,
          attributes: {},
        },
        {
          spanId: "span-b",
          parentSpanId: "span-a", // cycle back
          startTime: 100,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toBeNull();
    });
  });

  describe("when target span is not found in the span list", () => {
    it("returns null", () => {
      const spans = [
        {
          spanId: "other-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {
            "langwatch.prompt.id": "team/prompt:1",
          },
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "missing-span",
        spans,
      });

      expect(result).toBeNull();
    });
  });

  describe("when sibling prompt ref has same startTime as target", () => {
    it("finds the sibling (same-ms siblings are included)", () => {
      const spans = [
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
        {
          spanId: "sibling-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {
            "langwatch.prompt.id": "team/same-time-prompt:1",
          },
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      // Same startTime siblings are included because Prompt.compile and the
      // LLM span often start at the exact same millisecond in practice.
      expect(result).toEqual({
        promptHandle: "team/same-time-prompt",
        promptVersionNumber: 1,
        promptVariables: null,
      });
    });
  });

  describe("when Prompt.compile has the same startTime as the LLM span", () => {
    it("finds the Prompt.compile sibling (not skipped)", () => {
      // Regression: Prompt.compile and the llm span often start at the
      // exact same millisecond. The old `>=` guard skipped same-ms siblings.
      const spans = [
        {
          spanId: "parent",
          parentSpanId: null,
          startTime: 1000,
          attributes: {},
        },
        {
          spanId: "prompt-compile",
          parentSpanId: "parent",
          startTime: 1050,
          attributes: {
            "langwatch.prompt.id": "tea-prompt:4",
            "langwatch.prompt.handle": "tea-prompt",
            "langwatch.prompt.version.number": "4",
          },
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent",
          startTime: 1050, // same millisecond as Prompt.compile
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "tea-prompt",
        promptVersionNumber: 4,
        promptVariables: null,
      });
    });
  });

  describe("when PromptApiService.get starts first, then llm and Prompt.compile at same ms", () => {
    it("prefers Prompt.compile because it has more detail", () => {
      // Real trace pattern: PromptApiService.get started first (has prompt id),
      // then Prompt.compile and llm span at the same millisecond.
      // Prompt.compile has handle + version, so it should be preferred.
      const spans = [
        {
          spanId: "parent",
          parentSpanId: null,
          startTime: 1000,
          attributes: {},
        },
        {
          spanId: "prompt-api-get",
          parentSpanId: "parent",
          startTime: 1010,
          attributes: {
            "langwatch.prompt.id": "tea-prompt:4",
          },
        },
        {
          spanId: "prompt-compile",
          parentSpanId: "parent",
          startTime: 1050,
          attributes: {
            "langwatch.prompt.id": "tea-prompt:4",
            "langwatch.prompt.handle": "tea-prompt",
            "langwatch.prompt.version.number": "4",
          },
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent",
          startTime: 1050, // same as Prompt.compile
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      // Prompt.compile (startTime=1050) is at the same ms as llm (1050),
      // but it's included now. PromptApiService.get (startTime=1010) also
      // qualifies. The closest preceding (highest startTime) wins: Prompt.compile.
      expect(result).toEqual({
        promptHandle: "tea-prompt",
        promptVersionNumber: 4,
        promptVariables: null,
      });
    });
  });

  describe("when real SDK trace structure with PromptApiService.get and Prompt.compile siblings", () => {
    it("finds the Prompt.compile sibling's prompt reference", () => {
      // Real trace structure from the bug report:
      // main (parent of all)
      // ├── PromptApiService.get  (has langwatch.prompt.id = "tea-prompt:4")
      // ├── Prompt.compile        (has langwatch.prompt.id, handle, version)
      // └── llm                   (the LLM span)
      const spans = [
        {
          spanId: "main",
          parentSpanId: null,
          startTime: 1000,
          attributes: {},
        },
        {
          spanId: "prompt-api-get",
          parentSpanId: "main",
          startTime: 1010,
          attributes: {
            "langwatch.prompt.id": "tea-prompt:4",
          },
        },
        {
          spanId: "prompt-compile",
          parentSpanId: "main",
          startTime: 1020,
          attributes: {
            "langwatch.prompt.id": "tea-prompt:4",
            "langwatch.prompt.handle": "tea-prompt",
            "langwatch.prompt.version.number": "4",
          },
        },
        {
          spanId: "llm-span",
          parentSpanId: "main",
          startTime: 1030,
          attributes: {},
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      // Should find Prompt.compile (closest preceding sibling)
      expect(result).toEqual({
        promptHandle: "tea-prompt",
        promptVersionNumber: 4,
        promptVariables: null,
      });
    });
  });

  describe("when using flattenParamsToPromptAttributes with nested ES/frontend params", () => {
    it("finds sibling prompt ref from nested params format", () => {
      // Simulates the real use case: ES/frontend spans have nested params,
      // which must be flattened before passing to findPromptReferenceInAncestors.
      const nestedParams = {
        langwatch: {
          prompt: {
            id: "team/nested-prompt:5",
          },
        },
      };

      const spans = [
        {
          spanId: "parent-span",
          parentSpanId: null,
          startTime: 100,
          attributes: {},
        },
        {
          spanId: "sibling-span",
          parentSpanId: "parent-span",
          startTime: 200,
          attributes: flattenParamsToPromptAttributes(nestedParams),
        },
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          startTime: 300,
          attributes: flattenParamsToPromptAttributes(null),
        },
      ];

      const result = findPromptReferenceInAncestors({
        targetSpanId: "llm-span",
        spans,
      });

      expect(result).toEqual({
        promptHandle: "team/nested-prompt",
        promptVersionNumber: 5,
        promptVariables: null,
      });
    });
  });
});

describe("flattenParamsToPromptAttributes()", () => {
  describe("when params contain nested langwatch.prompt.id", () => {
    it("extracts the combined id format", () => {
      const result = flattenParamsToPromptAttributes({
        langwatch: { prompt: { id: "team/sample:3" } },
      });

      expect(result).toEqual({ "langwatch.prompt.id": "team/sample:3" });
    });
  });

  describe("when params contain separate handle and version", () => {
    it("extracts both keys", () => {
      const result = flattenParamsToPromptAttributes({
        langwatch: {
          prompt: {
            handle: "team/old-prompt",
            version: { number: "2" },
          },
        },
      });

      expect(result).toEqual({
        "langwatch.prompt.handle": "team/old-prompt",
        "langwatch.prompt.version.number": "2",
      });
    });
  });

  describe("when params contain variables", () => {
    it("extracts the variables key", () => {
      const result = flattenParamsToPromptAttributes({
        langwatch: {
          prompt: {
            id: "team/prompt:1",
            variables: '{"type":"json","value":{"name":"Alice"}}',
          },
        },
      });

      expect(result).toEqual({
        "langwatch.prompt.id": "team/prompt:1",
        "langwatch.prompt.variables":
          '{"type":"json","value":{"name":"Alice"}}',
      });
    });
  });

  describe("when params are null", () => {
    it("returns empty object", () => {
      expect(flattenParamsToPromptAttributes(null)).toEqual({});
    });
  });

  describe("when params are undefined", () => {
    it("returns empty object", () => {
      expect(flattenParamsToPromptAttributes(undefined)).toEqual({});
    });
  });

  describe("when params have no langwatch keys", () => {
    it("returns empty object", () => {
      const result = flattenParamsToPromptAttributes({
        temperature: 0.7,
        model: "gpt-4",
      });

      expect(result).toEqual({});
    });
  });

  describe("when params have partial nesting", () => {
    it("extracts only the keys that resolve", () => {
      const result = flattenParamsToPromptAttributes({
        langwatch: { prompt: { id: "team/prompt:1" } },
      });

      // Only "langwatch.prompt.id" resolves; handle, version.number, variables don't exist
      expect(result).toEqual({ "langwatch.prompt.id": "team/prompt:1" });
    });
  });
});
