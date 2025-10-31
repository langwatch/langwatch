import { describe, it } from "vitest";

describe("DatasetRepository", () => {
  describe("findBySlug", () => {
    describe("when slug exists in project", () => {
      it.todo("returns matching dataset");
    });

    describe("when using excludeId", () => {
      it.todo("excludes dataset with matching id");
      it.todo("finds other datasets with same slug");
    });

    describe("when slug not in project", () => {
      it.todo("returns null");
    });
  });

  describe("create", () => {
    it.todo("creates dataset with slug");
    it.todo("connects to project");
  });

  describe("update", () => {
    it.todo("updates name and slug atomically");
  });
});

