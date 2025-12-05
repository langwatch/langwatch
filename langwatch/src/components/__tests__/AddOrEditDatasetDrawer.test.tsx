import { describe, it } from "vitest";

describe("tryToConvertRowsToAppropriateType", () => {
  describe("when type is number", () => {
    it.todo("parses numeric strings to numbers");
    it.todo("converts empty values to null");
    it.todo("preserves NaN as-is");
  });

  describe("when type is boolean", () => {
    it.todo("converts 'true'/'1'/'yes' to true");
    it.todo("converts 'false'/'0'/'no' to false");
    it.todo("preserves non-boolean strings");
  });

  describe("when type is date", () => {
    it.todo("parses ISO strings to YYYY-MM-DD");
    it.todo("preserves invalid dates as-is");
  });

  describe("when type is json/list", () => {
    it.todo("parses JSON strings to objects");
    it.todo("ignores parse errors");
  });

  describe("when type is image", () => {
    it.todo("treats as string URL");
  });
});

