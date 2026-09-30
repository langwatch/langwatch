/**
 * @vitest-environment jsdom
 *
 * What a result table draws as a picture.
 *
 * @see specs/datasets/dataset-attachment-cells.feature
 */
import { describe, expect, it } from "vitest";
import { cellPictureUrl } from "../cellPictureUrl";

describe("given a stored reference", () => {
  describe("when the reference names a picture", () => {
    /** @scenario "A stored reference is drawn as a picture only when it names one" */
    it("answers with the reference, so the table draws it", () => {
      expect(cellPictureUrl("/api/files/p/so_abc/shot.png")).toBe(
        "/api/files/p/so_abc/shot.png",
      );
    });
  });

  describe("when the reference names a document or a recording", () => {
    /** @scenario "A stored reference is drawn as a picture only when it names one" */
    it.each([
      "/api/files/p/so_abc/quarter.pdf",
      "/api/files/p/so_abc/call.mp3",
    ])("answers with nothing for %s", (value) => {
      expect(cellPictureUrl(value)).toBeNull();
    });
  });
});

describe("given a cell value that is not a string", () => {
  describe("when the picture address is read", () => {
    /** @scenario "A cell value of any type is read without failing the table" */
    it.each([
      ["a number", 42],
      ["a boolean", true],
      ["a list", ["a", "b"]],
      ["an object", { a: 1 }],
      ["nothing", undefined],
      ["null", null],
    ])("answers with nothing for %s, rather than throwing", (_name, value) => {
      expect(() => cellPictureUrl(value)).not.toThrow();
      expect(cellPictureUrl(value)).toBeNull();
    });
  });
});

describe("given an address on another site", () => {
  describe("when it ends in a picture ending", () => {
    it("answers with the address", () => {
      expect(cellPictureUrl("https://example.com/shot.png")).toBe(
        "https://example.com/shot.png",
      );
    });
  });
});
