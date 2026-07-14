import { describe, it } from "vitest";

describe("datasetErrorHandler", () => {
  describe("when DatasetNotFoundError thrown", () => {
    it.todo("maps to NOT_FOUND tRPC error");
  });

  describe("when DatasetConflictError thrown", () => {
    it.todo("maps to CONFLICT tRPC error");
  });

  describe("when unknown error thrown", () => {
    it.todo("re-throws without mapping");
  });
});
