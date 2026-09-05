/**
 * The error id is offered on every failure, without exception.
 */
import { describe, expect, it } from "vitest";

import { resolveErrorCopy } from "../resolve-error-copy";

const TRACE_ID = "d2d07d1e4b70c2786e9139ee30a53e2a";

const wire = (error: Record<string, unknown>) => ({
  data: { error: { traceId: TRACE_ID, ...error } },
});

describe("resolveErrorCopy trace id", () => {
  describe("given a named failure the reader could resolve alone", () => {
    /** @scenario "The error id is offered on every failure" */
    it("still offers the error id", () => {
      expect(
        resolveErrorCopy({
          error: wire({
            code: "dataset_name_taken",
            httpStatus: 409,
            fault: "customer",
          }),
        }).traceId,
      ).toBe(TRACE_ID);
    });

    /** The anonymous share page is the case that prompted the gating. */
    it("offers it on the public share page too", () => {
      expect(
        resolveErrorCopy({
          error: wire({
            code: "share_link_not_found",
            httpStatus: 404,
            fault: "customer",
          }),
        }).traceId,
      ).toBe(TRACE_ID);
    });
  });

  describe("given a failure on our side", () => {
    /** @scenario "A platform fault keeps its error id" */
    it("offers the error id", () => {
      expect(
        resolveErrorCopy({
          error: wire({
            code: "workflow_execution_failed",
            httpStatus: 500,
            fault: "platform",
          }),
        }).traceId,
      ).toBe(TRACE_ID);
    });
  });

  describe("given a code the registry has no copy for", () => {
    /** @scenario "A failure with no copy for its code keeps its error id" */
    it("offers the error id", () => {
      expect(
        resolveErrorCopy({
          error: wire({ code: "not_a_code_we_know", httpStatus: 400 }),
        }).traceId,
      ).toBe(TRACE_ID);
    });
  });

  describe("given a failure that was never handled", () => {
    /** @scenario "An unhandled failure keeps its error id" */
    it("offers the error id from the envelope", () => {
      expect(
        resolveErrorCopy({
          error: { data: { traceId: TRACE_ID, code: "INTERNAL_SERVER_ERROR" } },
          fallbackTitle: "Couldn't create the dataset",
        }).traceId,
      ).toBe(TRACE_ID);
    });
  });
});
