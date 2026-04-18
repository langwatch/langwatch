import { describe, expect, it } from "vitest";
import { TRPCClientError, type TRPCClientErrorLike } from "@trpc/client";
import { getTraceErrorMessage } from "../getTraceErrorMessage";

describe("getTraceErrorMessage()", () => {
  const traceId = "trace_abc123";

  describe("when the error is a 404 NOT_FOUND", () => {
    it("returns 'Trace not found' with the trace_id", () => {
      const error = new TRPCClientError("Not found", {
        result: {
          error: {
            data: { code: "NOT_FOUND", httpStatus: 404 },
          },
        },
      });

      expect(getTraceErrorMessage({ error, traceId })).toBe(
        "Trace not found [trace_abc123]",
      );
    });
  });

  describe("when the error is a 500 INTERNAL_SERVER_ERROR", () => {
    it("returns 'Couldn't load trace' with the trace_id", () => {
      const error = new TRPCClientError("Internal server error", {
        result: {
          error: {
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      });

      expect(getTraceErrorMessage({ error, traceId })).toBe(
        "Couldn't load trace [trace_abc123]",
      );
    });
  });

  describe("when the error is a non-TRPCClientError", () => {
    it("returns 'Couldn't load trace' with the trace_id", () => {
      // Cast to simulate a non-TRPC error reaching the function at runtime
      const error = new Error(
        "Network failure",
      ) as unknown as TRPCClientErrorLike<any>;

      expect(getTraceErrorMessage({ error, traceId })).toBe(
        "Couldn't load trace [trace_abc123]",
      );
    });
  });

  describe("when the error is null", () => {
    it("returns 'Couldn't load trace' with the trace_id", () => {
      expect(getTraceErrorMessage({ error: null, traceId })).toBe(
        "Couldn't load trace [trace_abc123]",
      );
    });
  });
});
