import { describe, it } from "vitest";

describe("useDatasetSlugValidation", () => {
  describe("when editing existing dataset", () => {
    describe("when name unchanged", () => {
      it.todo("displays dbSlug");
      it.todo("sets slugWillChange=false");
    });

    describe("when name changed", () => {
      it.todo("displays computed slug after validation");
      it.todo("sets slugWillChange=true");
      it.todo("shows strikethrough dbSlug → new slug");
    });
  });

  describe("when creating new dataset", () => {
    it.todo("displays computed slug");
    it.todo("sets slugWillChange=false");
    it.todo("debounces API calls by 500ms");
  });

  describe("when slug conflicts", () => {
    it.todo("sets hasConflict=true");
    it.todo("returns conflictsWith dataset name");
  });

  describe("when name is empty", () => {
    it.todo("clears slugInfo");
    it.todo("hides slug display");
  });
});
