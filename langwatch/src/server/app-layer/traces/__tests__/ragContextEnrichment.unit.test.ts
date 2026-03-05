import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { generateDocumentId } from "../span-normalization.service";

describe("generateDocumentId", () => {
  describe("when content is a plain string", () => {
    it("returns MD5 hash of the trimmed content", () => {
      const content = "hello world";
      const expected = crypto
        .createHash("md5")
        .update(content)
        .digest("hex");

      expect(generateDocumentId(content)).toBe(expected);
    });
  });

  describe("when content is an object", () => {
    it("returns MD5 hash of JSON-stringified content", () => {
      const content = { text: "hello" };
      const expected = crypto
        .createHash("md5")
        .update(JSON.stringify(content))
        .digest("hex");

      expect(generateDocumentId(content)).toBe(expected);
    });
  });

  describe("when content is an array", () => {
    it("returns MD5 hash of joined array content", () => {
      const content = ["line 1", "line 2"];
      const expected = crypto
        .createHash("md5")
        .update("line 1\nline 2")
        .digest("hex");

      expect(generateDocumentId(content)).toBe(expected);
    });
  });
});
