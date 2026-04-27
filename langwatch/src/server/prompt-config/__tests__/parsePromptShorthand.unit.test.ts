import { describe, it, expect } from "vitest";
import {
  parsePromptShorthand,
  type PromptShorthand,
} from "../parsePromptShorthand";

describe("parsePromptShorthand()", () => {
  describe("when input is slug:tag format", () => {
    it("returns slug with tag", () => {
      expect(parsePromptShorthand("pizza-prompt:production")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "production",
        version: undefined,
        hadSuffix: true,
      });
    });
  });

  describe("when input is slug:number format", () => {
    it("returns slug with version", () => {
      expect(parsePromptShorthand("pizza-prompt:2")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: undefined,
        version: 2,
        hadSuffix: true,
      });
    });
  });

  describe("when input is a bare slug", () => {
    it("returns slug with no tag or version", () => {
      expect(parsePromptShorthand("pizza-prompt")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: undefined,
        version: undefined,
        hadSuffix: false,
      });
    });
  });

  describe("when input has 'latest' suffix", () => {
    it("returns slug with no tag or version but hadSuffix true", () => {
      expect(parsePromptShorthand("pizza-prompt:latest")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: undefined,
        version: undefined,
        hadSuffix: true,
      });
    });
  });

  describe("when slug contains a slash", () => {
    it("preserves the full slug and extracts the tag", () => {
      expect(parsePromptShorthand("my-org/prompt:staging")).toEqual<PromptShorthand>({
        slug: "my-org/prompt",
        tag: "staging",
        version: undefined,
        hadSuffix: true,
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
      expect(parsePromptShorthand("pizza-prompt:0")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "0",
        version: undefined,
        hadSuffix: true,
      });
    });
  });

  describe("when input is slug with negative number", () => {
    it("treats negative number as a tag since version must be positive", () => {
      expect(parsePromptShorthand("pizza-prompt:-1")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "-1",
        version: undefined,
        hadSuffix: true,
      });
    });
  });

  describe("when input is slug with float version", () => {
    it("treats float as a tag", () => {
      expect(parsePromptShorthand("pizza-prompt:1.5")).toEqual<PromptShorthand>({
        slug: "pizza-prompt",
        tag: "1.5",
        version: undefined,
        hadSuffix: true,
      });
    });
  });
});
