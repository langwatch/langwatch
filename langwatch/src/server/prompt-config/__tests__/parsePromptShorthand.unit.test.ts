import { describe, it, expect } from "vitest";
import {
  parsePromptShorthand,
  type PromptShorthand,
} from "../parsePromptShorthand";

describe("parsePromptShorthand()", () => {
  describe("when input is slug:tag format", () => {
    it("returns slug with tag", () => {
      const result = parsePromptShorthand("pizza-prompt:production");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "production",
        version: undefined,
      });
    });
  });

  describe("when input is slug:number format", () => {
    it("returns slug with version", () => {
      const result = parsePromptShorthand("pizza-prompt:2");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: undefined,
        version: 2,
      });
    });
  });

  describe("when input is a bare slug", () => {
    it("returns slug with no tag or version", () => {
      const result = parsePromptShorthand("pizza-prompt");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: undefined,
        version: undefined,
      });
    });
  });

  describe("when input has 'latest' suffix", () => {
    it("returns slug with no tag or version", () => {
      const result = parsePromptShorthand("pizza-prompt:latest");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: undefined,
        version: undefined,
      });
    });
  });

  describe("when slug contains a slash", () => {
    it("preserves the full slug and extracts the tag", () => {
      const result = parsePromptShorthand("my-org/prompt:staging");

      expect(result).toEqual<PromptShorthand>({
        slug: "my-org/prompt",
        tag: "staging",
        version: undefined,
      });
    });
  });

  describe("when slug is empty before colon", () => {
    it("throws an error indicating invalid format", () => {
      expect(() => parsePromptShorthand(":production")).toThrow(
        /invalid.*format/i,
      );
    });
  });

  describe("when suffix after colon is empty", () => {
    it("throws an error indicating invalid format", () => {
      expect(() => parsePromptShorthand("pizza-prompt:")).toThrow(
        /invalid.*format/i,
      );
    });
  });

  describe("when input is slug with version 0", () => {
    it("treats 0 as a tag since version must be positive", () => {
      const result = parsePromptShorthand("pizza-prompt:0");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "0",
        version: undefined,
      });
    });
  });

  describe("when input is slug with negative number", () => {
    it("treats negative number as a tag since version must be positive", () => {
      const result = parsePromptShorthand("pizza-prompt:-1");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "-1",
        version: undefined,
      });
    });
  });

  describe("when input is slug with float version", () => {
    it("treats float as a tag", () => {
      const result = parsePromptShorthand("pizza-prompt:1.5");

      expect(result).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "1.5",
        version: undefined,
      });
    });
  });
});
