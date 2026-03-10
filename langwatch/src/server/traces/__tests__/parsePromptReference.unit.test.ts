import { describe, it, expect } from "vitest";
import { parsePromptReference } from "../parsePromptReference";

describe("parsePromptReference()", () => {
  describe("when new combined format is present", () => {
    it("parses handle:version from langwatch.prompt.id", () => {
      const attrs = { "langwatch.prompt.id": "team/sample-prompt:3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "team/sample-prompt",
        promptVersionNumber: 3,
      });
    });

    it("handles handles with slashes", () => {
      const attrs = { "langwatch.prompt.id": "my-org/deep/nested-prompt:12" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "my-org/deep/nested-prompt",
        promptVersionNumber: 12,
      });
    });

    it("parses version 1", () => {
      const attrs = { "langwatch.prompt.id": "simple-prompt:1" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: "simple-prompt",
        promptVersionNumber: 1,
      });
    });

    it("returns nulls for non-integer version", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:abc" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
      });
    });

    it("returns nulls for version 0", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:0" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
      });
    });

    it("returns nulls for negative version", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:-1" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
      });
    });

    it("returns nulls for empty handle before colon", () => {
      const attrs = { "langwatch.prompt.id": ":3" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
      });
    });

    it("returns nulls for float version", () => {
      const attrs = { "langwatch.prompt.id": "team/prompt:1.5" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
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
      });
    });

    it("returns nulls when handle is missing", () => {
      const attrs = { "langwatch.prompt.version.number": "2" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
      });
    });

    it("returns nulls when version number is missing", () => {
      const attrs = { "langwatch.prompt.handle": "team/sample-prompt" };
      expect(parsePromptReference(attrs)).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
      });
    });
  });

  describe("when no prompt attributes exist", () => {
    it("returns nulls for empty attrs", () => {
      expect(parsePromptReference({})).toEqual({
        promptHandle: null,
        promptVersionNumber: null,
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
      });
    });
  });
});
