import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { withDatasetErrorHandling } from "../middleware";
import { DatasetNotFoundError, DatasetConflictError } from "../errors";

describe("datasetErrorHandler", () => {
  describe("when DatasetNotFoundError thrown", () => {
    it("maps to NOT_FOUND tRPC error", async () => {
      await expect(
        withDatasetErrorHandling(() => {
          throw new DatasetNotFoundError("Dataset missing");
        })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "NOT_FOUND",
          message: "Dataset missing",
        })
      );
    });
  });

  describe("when DatasetConflictError thrown", () => {
    it("maps to CONFLICT tRPC error", async () => {
      await expect(
        withDatasetErrorHandling(() => {
          throw new DatasetConflictError("Duplicate slug");
        })
      ).rejects.toThrow(
        expect.objectContaining({
          code: "CONFLICT",
          message: "Duplicate slug",
        })
      );
    });
  });

  describe("when unknown error thrown", () => {
    it("re-throws without mapping", async () => {
      const unknownError = new Error("Some unexpected error");
      await expect(
        withDatasetErrorHandling(() => {
          throw unknownError;
        })
      ).rejects.toThrow(unknownError);
    });
  });
});

