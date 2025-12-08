import { describe, it } from "vitest";

describe("DatasetRepository", () => {
  describe("findOne", () => {
    describe("when dataset exists", () => {
      it.todo("returns matching dataset by id and projectId");
    });

    describe("when dataset not found", () => {
      it.todo("returns null");
    });

    describe("when using transaction", () => {
      it.todo("uses provided tx client");
    });
  });

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

    describe("when using transaction", () => {
      it.todo("uses provided tx client");
    });
  });

  describe("create", () => {
    it.todo("creates dataset with slug");
    it.todo("connects to project");
  });

  describe("update", () => {
    it.todo("updates name and slug atomically");
    it.todo("validates dataset belongs to project before updating");
    it.todo("throws Error if dataset not found in project");
    it.todo("uses transaction client when provided");
  });

  describe("getProjectWithOrgS3Settings", () => {
    describe("when org has custom S3", () => {
      it.todo("returns canUseS3 true");
    });

    describe("when org has no custom S3", () => {
      it.todo("returns canUseS3 false");
    });
  });

  describe("findAllSlugs", () => {
    it.todo("returns all slugs for project");
  });
});
