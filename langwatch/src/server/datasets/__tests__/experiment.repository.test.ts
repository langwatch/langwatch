import { describe, it } from "vitest";

describe("ExperimentRepository", () => {
  describe("findExperiment", () => {
    describe("when experiment exists", () => {
      it.todo("returns matching experiment by id and projectId");
    });

    describe("when experiment not found", () => {
      it.todo("returns null");
    });

    describe("when experiment from different project exists", () => {
      it.todo("returns null");
    });
  });
});
