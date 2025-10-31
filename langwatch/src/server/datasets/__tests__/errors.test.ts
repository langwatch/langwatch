import { describe, it, expect } from "vitest";
import { DatasetNotFoundError, DatasetConflictError } from "../errors";

describe("Dataset Errors", () => {
  describe("DatasetNotFoundError", () => {
    it("has name='DatasetNotFoundError'", () => {
      const error = new DatasetNotFoundError();
      expect(error.name).toBe("DatasetNotFoundError");
    });

    it("includes message", () => {
      const error = new DatasetNotFoundError("Custom not found");
      expect(error.message).toBe("Custom not found");
    });
  });

  describe("DatasetConflictError", () => {
    it("has name='DatasetConflictError'", () => {
      const error = new DatasetConflictError();
      expect(error.name).toBe("DatasetConflictError");
    });

    it("has default message about duplicate name", () => {
      const error = new DatasetConflictError();
      expect(error.message).toContain("already exists");
    });
  });
});

