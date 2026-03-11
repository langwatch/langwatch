import { describe, it, expect } from "vitest";
import { findPromptReferenceInAncestors } from "../findPromptReferenceInAncestors";

describe("findPromptReferenceInAncestors()", () => {
  describe("when prompt ref is on immediate parent", () => {
    it("returns the parent's prompt reference", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
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
          attributes: {},
        },
        {
          spanId: "middle-span",
          parentSpanId: "grandparent-span",
          attributes: {},
        },
        {
          spanId: "grandparent-span",
          parentSpanId: null,
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

  describe("when prompt ref is on a sibling (not ancestor)", () => {
    it("does not find the reference", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
          attributes: {},
        },
        {
          spanId: "sibling-span",
          parentSpanId: "parent-span",
          attributes: {
            "langwatch.prompt.id": "team/sibling-prompt:1",
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

  describe("when no ancestor has a prompt reference", () => {
    it("returns null", () => {
      const spans = [
        {
          spanId: "llm-span",
          parentSpanId: "parent-span",
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
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
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: null,
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
          attributes: {},
        },
        {
          spanId: "parent-span",
          parentSpanId: "grandparent-span",
          attributes: {
            "langwatch.prompt.id": "team/nearest:2",
          },
        },
        {
          spanId: "grandparent-span",
          parentSpanId: null,
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

  describe("when target span is not found in the span list", () => {
    it("returns null", () => {
      const spans = [
        {
          spanId: "other-span",
          parentSpanId: null,
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
});
