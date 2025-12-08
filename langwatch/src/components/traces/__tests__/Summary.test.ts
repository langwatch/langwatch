import { describe, it } from "vitest";

describe("handleMetadataTagClick", () => {
  describe("when key is trace_id", () => {
    it.todo("sets query param with trace_id search syntax");
  });

  describe("when key is a reserved metadata key", () => {
    it.todo("sets the mapped urlKey param");

    describe("when originalValue is an array", () => {
      it.todo("uses first array element as filter value");
    });

    describe("when originalValue is not an array", () => {
      it.todo("uses value directly as filter value");
    });
  });

  describe("when key is a custom metadata key", () => {
    it.todo("sets metadata_key param");
    it.todo("sets metadata.{key} param with value");

    describe("when key contains dots", () => {
      it.todo("replaces dots with middle dots in key");
    });
  });

  describe("when navigating", () => {
    it.todo("clears existing filter params");
    it.todo("clears existing query param");
    it.todo("preserves non-filter query params");
  });
});

