import { describe, it, expect } from "vitest";
import { parsePromptReference } from "../parsePromptReference";

describe("parsePromptReference()", () => {
  describe("when new combined format is present", () => {
    it("parses handle:version from langwatch.prompt.id", () => {
      const attrs = { "langwatch.prompt.id": "team/sample-prompt:3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/sample-prompt",
        promptVersionNumber: 3,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("handles handles with slashes", () => {
      const attrs = { "langwatch.prompt.id": "my-org/deep/nested-prompt:12" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "my-org/deep/nested-prompt",
        promptVersionNumber: 12,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("parses version 1", () => {
      const attrs = { "langwatch.prompt.id": "simple-prompt:1" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "simple-prompt",
        promptVersionNumber: 1,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("resolves non-integer suffix as a label", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:abc" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptLabel: "abc",
        promptVariables: null,
      });
    });

    it("resolves zero suffix as a label", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:0" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptLabel: "0",
        promptVariables: null,
      });
    });

    it("resolves negative suffix as a label", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:-1" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptLabel: "-1",
        promptVariables: null,
      });
    });

    it("returns nulls for empty handle before colon", () => {
      const attrs = { "langwatch.prompt.id": ":3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("resolves float suffix as a label", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:1.5" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptLabel: "1.5",
        promptVariables: null,
      });
    });
  });

  describe("when slug:label shorthand is present", () => {
    it("resolves to handle and label", () => {
      const attrs = { "langwatch.prompt.id": "pizza-prompt:production" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "pizza-prompt",
        promptVersionNumber: null,
        promptLabel: "production",
        promptVariables: null,
      });
    });

    it("resolves slug:number to handle and version", () => {
      const attrs = { "langwatch.prompt.id": "pizza-prompt:3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "pizza-prompt",
        promptVersionNumber: 3,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("treats 'latest' suffix as no label or version", () => {
      const attrs = { "langwatch.prompt.id": "pizza-prompt:latest" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "pizza-prompt",
        promptVersionNumber: null,
        promptLabel: null,
        promptVariables: null,
      });
    });
  });

  describe("when old separate format is present", () => {
    it("parses handle and version number from separate attributes", () => {
      const attrs = {
        "langwatch.prompt.handle": "team/sample-prompt",
        "langwatch.prompt.version.number": "2",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/sample-prompt",
        promptVersionNumber: 2,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("parses numeric version number", () => {
      const attrs = {
        "langwatch.prompt.handle": "team/sample-prompt",
        "langwatch.prompt.version.number": 5,
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/sample-prompt",
        promptVersionNumber: 5,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("returns nulls when handle is missing", () => {
      const attrs = { "langwatch.prompt.version.number": "2" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("returns nulls when version number is missing", () => {
      const attrs = { "langwatch.prompt.handle": "team/sample-prompt" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptLabel: null,
        promptVariables: null,
      });
    });
  });

  describe("when no prompt attributes exist", () => {
    it("returns nulls for empty attrs", () => {
      expect(parsePromptReference({})).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptLabel: null,
        promptVariables: null,
      });
    });

    it("returns nulls for UUID-only prompt id without colon", () => {
      const attrs = {
        "langwatch.prompt.id": "clxyz123abc",
        "langwatch.prompt.version.id": "ver456def",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptLabel: null,
        promptVariables: null,
      });
    });
  });

  describe("when new format takes precedence over old format", () => {
    it("prefers combined format over separate attributes", () => {
      const attrs = {
        "langwatch.prompt.id": "team/new-prompt:5",
        "langwatch.prompt.handle": "team/old-prompt",
        "langwatch.prompt.version.number": "1",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/new-prompt",
        promptVersionNumber: 5,
        promptLabel: null,
        promptVariables: null,
      });
    });
  });

  describe("when prompt variables are present", () => {
    it("extracts variables from valid JSON wrapper", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables":
          '{"type":"json","value":{"name":"Alice","topic":"AI"}}',
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toEqual({
        name: "Alice",
        topic: "AI",
      });
    });

    it("converts non-string values to strings", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables":
          '{"type":"json","value":{"count":42,"active":true,"empty":null}}',
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toEqual({
        count: "42",
        active: "true",
        empty: "null",
      });
    });

    it("returns null variables for invalid JSON", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables": "not valid json",
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toBeNull();
    });

    it("returns null variables when value key is missing", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables": '{"type":"json"}',
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toBeNull();
    });

    it("returns null variables when value is not an object", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables": '{"type":"json","value":"string-value"}',
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toBeNull();
    });

    it("returns null variables when value is an array", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables": '{"type":"json","value":["a","b"]}',
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toBeNull();
    });

    it("returns null variables when attribute is not a string", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
        "langwatch.prompt.variables": 123,
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toBeNull();
    });

    it("returns null variables when attribute is missing", () => {
      const attrs = {
        "langwatch.prompt.id": "team/sample-prompt:3",
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toBeNull();
    });

    it("extracts variables even without prompt handle", () => {
      const attrs = {
        "langwatch.prompt.variables":
          '{"type":"json","value":{"name":"Alice"}}',
      };
      const result = parsePromptReference(attrs);
      expect(result.promptHandle).toBeNull();
      expect(result.promptVersionNumber).toBeNull();
      expect(result.promptLabel).toBeNull();
      expect(result.promptVariables).toEqual({ name: "Alice" });
    });
  });
});
