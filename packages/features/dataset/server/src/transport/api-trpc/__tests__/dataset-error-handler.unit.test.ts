/** @vitest-environment node */

import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  ColumnTypeChangeNotSupportedError,
  DatasetConflictError,
  DatasetNotFoundError,
  DatasetNotReadyError,
} from "../../../services/errors";
import { datasetErrorHandler } from "../dataset.api";

/**
 * Assertions are on `code`, never on message prose: the message is server copy
 * and the words a customer reads come from the client's presentation registry
 * keyed by that code (ADR-045). A test that pins the sentence pins the wrong
 * half of the contract.
 *
 * The middleware is driven through a `next` that behaves the way tRPC's does —
 * it RESOLVES with `{ ok: false, error }` rather than throwing, with the
 * original on `error.cause`. That is the entire point of this file: the
 * previous version drove a plain throwing callback, so it passed against a
 * middleware whose translation could never run, and a duplicate dataset name
 * reached customers as an unknown 500.
 */
const OK = { ok: true as const, data: { rows: 3 }, marker: Symbol.for("ok") };

/** tRPC's own wrapping: anything not already a `TRPCError` lands on `cause`. */
const rejectedNext = (cause: unknown) => () =>
  Promise.resolve({
    ok: false as const,
    error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
  });

const failWith = (cause: unknown) =>
  datasetErrorHandler({ next: rejectedNext(cause) }).then(
    (result) => ({ returned: result }),
    (thrown: unknown) => ({ thrown }),
  );

describe("datasetErrorHandler", () => {
  describe("given the resolver succeeds", () => {
    /** @scenario "A successful call passes through the middleware untouched" */
    it("passes the result through untouched", async () => {
      await expect(datasetErrorHandler({ next: () => Promise.resolve(OK) })).resolves.toBe(OK);
    });
  });

  describe("when DatasetNotFoundError reaches the boundary", () => {
    it("maps to a NOT_FOUND tRPC error", async () => {
      const outcome = await failWith(new DatasetNotFoundError());

      expect(outcome).toMatchObject({ thrown: { code: "NOT_FOUND" } });
    });
  });

  describe("when a name clash raises DatasetConflictError", () => {
    /** @scenario "A domain error raised by the resolver is translated by the middleware" */
    it("maps to the dataset_name_taken handled error", async () => {
      const outcome = await failWith(new DatasetConflictError());

      expect(outcome).toMatchObject({
        thrown: {
          code: "dataset_name_taken",
          httpStatus: 409,
          fault: "customer",
        },
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
    /** @scenario "A stale-columns conflict keeps its own code through the middleware" */
    it("maps to the dataset_stale_columns handled error, not the name clash", async () => {
      const outcome = await failWith(
        new DatasetConflictError(
          "Dataset columns changed since you opened the editor — please reopen and retry.",
          { reason: "stale_columns" },
        ),
      );

      expect(outcome).toMatchObject({
        thrown: {
          code: "dataset_stale_columns",
          httpStatus: 409,
          fault: "customer",
        },
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

      const outcome = await failWith(error);

      expect(outcome).toMatchObject({
        returned: {
          ok: false,
          error: { cause: { code: "dataset_column_type_change_unsupported" } },
        },
      });
    });

    it("passes DatasetNotReadyError through with its status in meta", async () => {
      const error = new DatasetNotReadyError({ status: "processing" });

      const outcome = await failWith(error);

      expect(outcome).toMatchObject({
        returned: {
          ok: false,
          error: {
            cause: {
              code: "dataset_not_ready",
              httpStatus: 425,
              meta: { status: "processing" },
            },
          },
        },
      });
    });
  });

  /**
   * An infrastructure failure must keep the result tRPC already built for it —
   * its code, its logging, its trace id. Re-throwing the cause here would strip
   * all three and re-wrap it a second time.
   */
  describe("when an unrelated error reaches the boundary", () => {
    /** @scenario "An infrastructure failure is left alone by the middleware" */
    it("hands tRPC's own result back rather than re-raising", async () => {
      const boom = new Error("connection reset");

      const outcome = await failWith(boom);

      expect(outcome).toMatchObject({
        returned: { ok: false, error: { code: "INTERNAL_SERVER_ERROR" } },
      });
      expect("thrown" in outcome).toBe(false);
    });
  });

  /**
   * A `TRPCError` raised directly by the resolver has no `cause`. Reading only
   * `cause` would hand `undefined` to the translator and lose the error.
   */
  describe("when the resolver raised a TRPCError itself", () => {
    it("keeps it", async () => {
      const outcome = await datasetErrorHandler({
        next: () =>
          Promise.resolve({
            ok: false as const,
            error: new TRPCError({ code: "FORBIDDEN" }),
          }),
      }).then(
        (result) => ({ returned: result }),
        (thrown: unknown) => ({ thrown }),
      );

      expect(outcome).toMatchObject({
        returned: { ok: false, error: { code: "FORBIDDEN" } },
      });
    });
  });
});
