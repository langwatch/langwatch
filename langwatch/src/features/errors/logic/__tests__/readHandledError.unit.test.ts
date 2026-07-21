/**
 * `readHandledError` sits on untrusted input: a rolling deploy, an older
 * server, or a Go service can all hand it a payload it wasn't written for, and
 * none of those may take a render down with them. `null` (→ generic unknown
 * treatment) is always an acceptable answer; throwing never is.
 */
import { describe, expect, it } from "vitest";

import { readErrorTraceId, readHandledError } from "../readHandledError";

const trpcError = (error: unknown, traceId?: string) => ({
  data: { error, ...(traceId ? { traceId } : {}) },
});

describe("readHandledError", () => {
  describe("given a well-formed handled payload", () => {
    it("lifts every field the UI renders", () => {
      const result = readHandledError(
        trpcError({
          code: "trace_not_found",
          httpStatus: 404,
          fault: "customer",
          meta: { traceId: "abc" },
          tips: ["Check the trace id"],
          docsUrl: "https://docs.langwatch.ai/platform/data-retention",
          traceId: "4bf92f",
          reasons: [{ code: "unknown", kind: "unknown" }],
        }),
      );

      expect(result).toMatchObject({
        code: "trace_not_found",
        httpStatus: 404,
        fault: "customer",
        tips: ["Check the trace id"],
        traceId: "4bf92f",
      });
      expect(result?.reasons).toHaveLength(1);
    });
  });

  describe("given a payload from an older server", () => {
    it("resolves the discriminant from the deprecated kind alias", () => {
      const result = readHandledError(
        trpcError({ kind: "project_not_found", httpStatus: 404 }),
      );

      expect(result?.code).toBe("project_not_found");
    });

    it("defaults a missing fault to customer, matching the server", () => {
      const result = readHandledError(
        trpcError({ code: "project_not_found", httpStatus: 404 }),
      );

      expect(result?.fault).toBe("customer");
    });
  });

  describe("given a malformed payload", () => {
    it.each([
      ["no payload at all", {}],
      ["a null payload", trpcError(null)],
      ["a string payload", trpcError("boom")],
      ["no discriminant", trpcError({ httpStatus: 404 })],
      ["no httpStatus", trpcError({ code: "trace_not_found" })],
      ["a non-numeric httpStatus", trpcError({ code: "x", httpStatus: "404" })],
    ])("returns null for %s", (_label, error) => {
      expect(readHandledError(error)).toBeNull();
    });

    it("survives fields of entirely the wrong type", () => {
      const result = readHandledError(
        trpcError({
          code: "trace_not_found",
          httpStatus: 404,
          meta: "not an object",
          tips: "not an array",
          fault: "not a fault",
          docsUrl: 42,
          reasons: null,
        }),
      );

      expect(result).toMatchObject({
        meta: {},
        tips: [],
        fault: "customer",
        docsUrl: undefined,
        reasons: [],
      });
    });

    it("drops non-string entries from tips rather than rendering them", () => {
      const result = readHandledError(
        trpcError({
          code: "trace_not_found",
          httpStatus: 404,
          tips: ["keep this", 42, null, { nope: true }],
        }),
      );

      expect(result?.tips).toEqual(["keep this"]);
    });
  });
});

describe("readErrorTraceId", () => {
  it("prefers the id inside the handled payload", () => {
    const traceId = readErrorTraceId(
      trpcError({ code: "x", httpStatus: 500, traceId: "from-payload" }, "from-envelope"),
    );

    expect(traceId).toBe("from-payload");
  });

  describe("when the failure was unhandled", () => {
    it("still finds the id, so support has something to correlate on", () => {
      const traceId = readErrorTraceId(trpcError(null, "from-envelope"));

      expect(traceId).toBe("from-envelope");
    });
  });

  it("returns undefined rather than guessing when there is no id", () => {
    expect(readErrorTraceId({})).toBeUndefined();
    expect(readErrorTraceId(new Error("boom"))).toBeUndefined();
  });
});
