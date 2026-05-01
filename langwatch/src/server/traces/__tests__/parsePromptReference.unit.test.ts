import { describe, it, expect } from "vitest";
import { parsePromptReference } from "../parsePromptReference";

describe("parsePromptReference()", () => {
  describe("when new combined format is present", () => {
    it("parses handle:version from langwatch.prompt.id", () => {
      const attrs = { "langwatch.prompt.id": "team/sample-prompt:3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/sample-prompt",
        promptVersionNumber: 3,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("handles handles with slashes", () => {
      const attrs = { "langwatch.prompt.id": "my-org/deep/nested-prompt:12" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "my-org/deep/nested-prompt",
        promptVersionNumber: 12,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("parses version 1", () => {
      const attrs = { "langwatch.prompt.id": "simple-prompt:1" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "simple-prompt",
        promptVersionNumber: 1,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("resolves non-integer suffix as a tag", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:abc" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: "abc",
        promptVariables: null,
      });
    });

    it("resolves zero suffix as a tag", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:0" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: "0",
        promptVariables: null,
      });
    });

    it("resolves negative suffix as a tag", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:-1" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: "-1",
        promptVariables: null,
      });
    });

    it("returns nulls for empty handle before colon", () => {
      const attrs = { "langwatch.prompt.id": ":3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("resolves float suffix as a tag", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:1.5" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: "1.5",
        promptVariables: null,
      });
    });

    it("surfaces langwatch.prompt.version.id alongside combined format", () => {
      const attrs = {
        "langwatch.prompt.id": "team/prompt:3",
        "langwatch.prompt.version.id": "ver-abc123",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/prompt",
        promptVersionNumber: 3,
        promptVersionId: "ver-abc123",
        promptTag: null,
        promptVariables: null,
      });
    });
  });

  describe("when slug:tag shorthand is present", () => {
    it("resolves to handle and tag", () => {
      const attrs = { "langwatch.prompt.id": "pizza-prompt:production" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "pizza-prompt",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: "production",
        promptVariables: null,
      });
    });

    it("resolves slug:number to handle and version", () => {
      const attrs = { "langwatch.prompt.id": "pizza-prompt:3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "pizza-prompt",
        promptVersionNumber: 3,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("treats 'latest' suffix as no tag or version", () => {
      const attrs = { "langwatch.prompt.id": "pizza-prompt:latest" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "pizza-prompt",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });
  });

  describe("when flat format is present (bare-slug prompt.id with separate version attributes)", () => {
    it("treats bare-slug prompt.id as the handle", () => {
      const attrs = { "langwatch.prompt.id": "customer-support-v2" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "customer-support-v2",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("pairs bare-slug prompt.id with version.id", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.version.id": "ver-abc123",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "customer-support-v2",
        promptVersionNumber: null,
        promptVersionId: "ver-abc123",
        promptTag: null,
        promptVariables: null,
      });
    });

    it("pairs bare-slug prompt.id with version.number", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.version.number": 7,
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "customer-support-v2",
        promptVersionNumber: 7,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("pairs bare-slug prompt.id with both version.id and version.number", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.version.id": "ver-abc123",
        "langwatch.prompt.version.number": "7",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "customer-support-v2",
        promptVersionNumber: 7,
        promptVersionId: "ver-abc123",
        promptTag: null,
        promptVariables: null,
      });
    });

    it("ignores invalid version.number on a bare-slug handle", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.version.number": "not-a-number",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "customer-support-v2",
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
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
        promptVersionId: null,
        promptTag: null,
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
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("returns nulls when handle is missing", () => {
      const attrs = { "langwatch.prompt.version.number": "2" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("returns nulls when version number is missing", () => {
      const attrs = { "langwatch.prompt.handle": "team/sample-prompt" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });
  });

  describe("when no prompt attributes exist", () => {
    it("returns nulls for empty attrs", () => {
      expect(parsePromptReference({})).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("surfaces version.id even when no handle is present", () => {
      const attrs = { "langwatch.prompt.version.id": "ver-orphan" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
        promptVersionId: "ver-orphan",
        promptTag: null,
        promptVariables: null,
      });
    });
  });

  describe("format precedence", () => {
    it("prefers combined format over separate attributes", () => {
      const attrs = {
        "langwatch.prompt.id": "team/new-prompt:5",
        "langwatch.prompt.handle": "team/old-prompt",
        "langwatch.prompt.version.number": "1",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/new-prompt",
        promptVersionNumber: 5,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });

    it("flat-format prompt.id overrides legacy handle attribute", () => {
      const attrs = {
        "langwatch.prompt.id": "team/new-prompt",
        "langwatch.prompt.handle": "team/old-prompt",
        "langwatch.prompt.version.number": "9",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/new-prompt",
        promptVersionNumber: 9,
        promptVersionId: null,
        promptTag: null,
        promptVariables: null,
      });
    });
  });

  describe("when prompt variables are present (legacy JSON blob)", () => {
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
      expect(result.promptTag).toBeNull();
      expect(result.promptVariables).toEqual({ name: "Alice" });
    });
  });

  describe("when prompt variables are present (flat keys)", () => {
    it("extracts variables from flat langwatch.prompt.variables.<name> attributes", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.variables.customer_name": "Alice",
        "langwatch.prompt.variables.issue": "billing discrepancy",
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toEqual({
        customer_name: "Alice",
        issue: "billing discrepancy",
      });
    });

    it("coerces non-string scalar values to strings", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.variables.count": 42,
        "langwatch.prompt.variables.active": true,
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toEqual({
        count: "42",
        active: "true",
      });
    });

    it("ignores the bare prefix with no variable name", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.variables.": "noise",
        "langwatch.prompt.variables.real": "kept",
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toEqual({ real: "kept" });
    });

    it("works without any handle attribute", () => {
      const attrs = {
        "langwatch.prompt.variables.customer_name": "Alice",
      };
      const result = parsePromptReference(attrs);
      expect(result.promptHandle).toBeNull();
      expect(result.promptVariables).toEqual({ customer_name: "Alice" });
    });
  });

  describe("when both flat variable keys and JSON blob are present", () => {
    it("merges them, with flat keys winning on collision", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.variables":
          '{"type":"json","value":{"customer_name":"Bob","topic":"AI"}}',
        "langwatch.prompt.variables.customer_name": "Alice",
      };
      const result = parsePromptReference(attrs);
      expect(result.promptVariables).toEqual({
        customer_name: "Alice",
        topic: "AI",
      });
    });
  });

  describe("end-to-end flat shape", () => {
    it("parses the proposed canonical SDK emission shape", () => {
      const attrs = {
        "langwatch.prompt.id": "customer-support-v2",
        "langwatch.prompt.version.id": "ver-abc123",
        "langwatch.prompt.variables.customer_name": "Alice",
        "langwatch.prompt.variables.issue": "billing discrepancy",
      };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "customer-support-v2",
        promptVersionNumber: null,
        promptVersionId: "ver-abc123",
        promptTag: null,
        promptVariables: {
          customer_name: "Alice",
          issue: "billing discrepancy",
        },
      });
    });
  });
});
