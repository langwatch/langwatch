/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  ColumnTypeChangeNotSupportedError,
  DatasetConflictError,
  DatasetNotFoundError,
  DatasetNotReadyError,
} from "../errors";
import { withDatasetErrorHandling } from "../middleware";

/**
 * Assertions are on `code`, never on message prose: the message is server copy
 * and the words a customer reads come from the client's presentation registry
 * keyed by that code (ADR-045). A test that pins the sentence pins the wrong
 * half of the contract.
 */
const failWith = (error: unknown) =>
  withDatasetErrorHandling(() => Promise.reject(error)).then(
    () => null,
    (thrown: unknown) => thrown,
  );

describe("withDatasetErrorHandling", () => {
  describe("given the operation succeeds", () => {
    it("returns its value untouched", async () => {
      await expect(
        withDatasetErrorHandling(() => Promise.resolve({ rows: 3 })),
      ).resolves.toEqual({ rows: 3 });
    });
  });

  describe("when DatasetNotFoundError is thrown", () => {
    it("maps to a NOT_FOUND tRPC error", async () => {
      const thrown = await failWith(new DatasetNotFoundError());

      expect(thrown).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("when a name clash raises DatasetConflictError", () => {
    it("maps to the dataset_name_taken handled error", async () => {
      const thrown = await failWith(new DatasetConflictError());

      expect(thrown).toMatchObject({
        code: "dataset_name_taken",
        httpStatus: 409,
        fault: "customer",
      });
    });
  });

  /**
   * The regression this branch exists for: an optimistic-concurrency abort
   * (a concurrent column edit rewrote the chunks while this editor was open)
   * was a `DatasetConflictError` like any other, so it reached the customer as
   * "that name is taken — pick a different name". No rename could ever resolve
   * it, and the real remediation was discarded on the way out.
   */
  describe("when a stale editor raises DatasetConflictError", () => {
    it("maps to the dataset_stale_columns handled error, not the name clash", async () => {
      const thrown = await failWith(
        new DatasetConflictError(
          "Dataset columns changed since you opened the editor — please reopen and retry.",
          { reason: "stale_columns" },
        ),
      );

      expect(thrown).toMatchObject({
        code: "dataset_stale_columns",
        httpStatus: 409,
        fault: "customer",
      });
    });
  });

  /**
   * These two are `HandledError`s in their own right now, so the boundary has
   * nothing left to do: rebuilding them as `TRPCError`s was what made the
   * formatter read their message as inherited and degrade both to the generic
   * "unknown" state.
   */
  describe("when a dataset error already carries its own code", () => {
    it("passes ColumnTypeChangeNotSupportedError through untouched", async () => {
      const error = new ColumnTypeChangeNotSupportedError();

      const thrown = await failWith(error);

      expect(thrown).toBe(error);
      expect(thrown).toMatchObject({
        code: "dataset_column_type_change_unsupported",
        httpStatus: 400,
      });
    });

    it("passes DatasetNotReadyError through with its status in meta", async () => {
      const error = new DatasetNotReadyError({ status: "processing" });

      const thrown = await failWith(error);

      expect(thrown).toBe(error);
      expect(thrown).toMatchObject({
        code: "dataset_not_ready",
        httpStatus: 425,
        meta: { status: "processing" },
      });
    });
  });

  describe("when an unknown error is thrown", () => {
    it("re-throws it without mapping", async () => {
      const boom = new Error("connection reset");

      expect(await failWith(boom)).toBe(boom);
    });
  });
});
