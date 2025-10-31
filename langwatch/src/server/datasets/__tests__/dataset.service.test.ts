import { describe, it } from "vitest";

describe("DatasetService", () => {
  describe("validateDatasetName", () => {
    describe("when slug is available", () => {
      it.todo("returns available=true");
      it.todo("returns computed slug");
    });

    describe("when slug conflicts", () => {
      it.todo("returns available=false");
      it.todo("returns conflictsWith dataset name");
    });

    describe("when editing existing dataset", () => {
      it.todo("excludes current dataset from conflict check");
      it.todo("allows keeping same slug");
    });
  });

  describe("upsertDataset", () => {
    describe("when creating new dataset", () => {
      it.todo("generates slug from name");
      it.todo("throws DatasetConflictError if slug exists");
      it.todo("creates dataset with S3 config from org settings");
      it.todo("creates dataset records if provided");
      it.todo("wraps dataset and record creation in transaction");
    });

    describe("when creating with records and record creation fails", () => {
      it.todo("rolls back dataset creation");
    });

    describe("when updating existing dataset", () => {
      it.todo("updates slug when name changes");
      it.todo("throws DatasetNotFoundError if dataset missing");
      it.todo("triggers column migration when columnTypes differ");
      it.todo("preserves slug format (kebab-case)");
      it.todo("throws DatasetConflictError if slug collides with another dataset");
      it.todo("allows updating with same name/slug without conflict");
      it.todo("wraps all operations in transaction for atomicity");
    });

    describe("when using experimentId", () => {
      it.todo("resolves name from experiment");
      it.todo("appends (2) if experiment name conflicts");
      it.todo("defaults to 'Draft Dataset' if no experiment");
    });
  });

  describe("findNextAvailableName", () => {
    describe("when base name available", () => {
      it.todo("returns base name unchanged");
    });

    describe("when base name conflicts", () => {
      it.todo("returns 'Name (2)' for first conflict");
      it.todo("returns 'Name (3)' if (2) also exists");
    });
  });

  describe("generateSlug", () => {
    it.todo("converts to lowercase");
    it.todo("replaces spaces with hyphens");
    it.todo("replaces ALL underscores with hyphens");
    it.todo("removes special characters");
  });
});

