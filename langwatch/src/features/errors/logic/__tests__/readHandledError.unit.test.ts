/**
 * `readHandledError` sits on untrusted input: a rolling deploy, an older
 * server, or a Go service can all hand it a payload it wasn't written for, and
 * none of those may take a render down with them. `null` (→ generic unknown
 * treatment) is always an acceptable answer; throwing never is.
 */
import { describe, expect, it } from "vitest";

import {
  handledShapeFromSerialized,
  readAuthoredMessage,
  readErrorTraceId,
  readHandledError,
} from "../readHandledError";

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

    /**
     * Tips ride the same relay path `meta.message` is clamped for — a Go
     * service parses them off an upstream response body — so an upstream that
     * answers with an essay must not get to render an essay inside our own
     * error chrome. The alert lists every one of them.
     */
    it("caps how many tips an upstream can put on screen", () => {
      const result = readHandledError(
        trpcError({
          code: "trace_not_found",
          httpStatus: 404,
          tips: ["one", "two", "three", "four", "five", "six"],
        }),
      );

      expect(result?.tips.length).toBeLessThanOrEqual(4);
    });

    it("clamps a tip that runs to a paragraph", () => {
      const result = readHandledError(
        trpcError({
          code: "trace_not_found",
          httpStatus: 404,
          tips: ["x".repeat(5000)],
        }),
      );

      const clamped = result?.tips[0];
      expect(typeof clamped).toBe("string");
      expect(clamped?.length).toBeLessThan(250);
    });
  });

  describe("given a docs link", () => {
    it("keeps one on our own docs origin", () => {
      const result = readHandledError(
        trpcError({
          code: "trace_not_found",
          httpStatus: 404,
          docsUrl: "https://docs.langwatch.ai/platform/data-retention",
        }),
      );

      expect(result?.docsUrl).toBe(
        "https://docs.langwatch.ai/platform/data-retention",
      );
    });

    /**
     * https alone was not enough. `docs_url` is parsed off an upstream
     * response body with a bare `z.string()` (`nlpgo/goHandledError.ts`,
     * `langy/streaming/langyRelayFrame.ts`), and `ErrorActions` turns it into
     * the href behind "Read the docs" — so any-https meant a customer-
     * configured endpoint could put its own link inside LangWatch's chrome.
     */
    it.each([
      ["another origin entirely", "https://docs.evil.example/langwatch"],
      ["a lookalike host", "https://docs.langwatch.ai.evil.example/errors"],
      ["a javascript: url", "javascript:alert(document.cookie)"],
      ["plain http on the right host", "http://docs.langwatch.ai/errors"],
      ["a relative path", "/errors/query-timeout"],
    ])("refuses %s", (_label, docsUrl) => {
      const result = readHandledError(
        trpcError({ code: "trace_not_found", httpStatus: 404, docsUrl }),
      );

      expect(result?.docsUrl).toBeUndefined();
    });
  });

  describe("given a handled error from a REST route", () => {
    /**
     * Hono routes send the handled error FLAT — the code in `error`, `meta`
     * spread at the top level, the trace under `trace` (see
     * `src/app/api/middleware/error-handler.ts`). Reading only the tRPC
     * envelope meant every one of them reached the UI as an unhandled error:
     * no registry copy, no docs link, no trace id, for a failure the server
     * had named precisely.
     */
    it("lifts the code, meta and trace id off the flat body", () => {
      const result = readHandledError({
        error: "dataset_name_taken",
        message: "A dataset named 'foo' already exists",
        datasetName: "foo",
        tips: ["Pick a different name"],
        docsUrl: "https://docs.langwatch.ai/datasets",
        fault: "customer",
        trace: { traceId: "4bf92f", spanId: "00f067" },
      });

      expect(result).toMatchObject({
        code: "dataset_name_taken",
        fault: "customer",
        tips: ["Pick a different name"],
        docsUrl: "https://docs.langwatch.ai/datasets",
        traceId: "4bf92f",
      });
      // The flat body spreads meta at the top level, and the sentence rides
      // along as `meta.message` — the channel the registry reads for a code it
      // has no copy for.
      expect(result?.meta).toMatchObject({
        datasetName: "foo",
        message: "A dataset named 'foo' already exists",
      });
    });

    it.each([
      ["an unhandled 500", { error: "Internal server error" }],
      [
        "a Prisma conflict",
        { error: "Conflict", message: "Unique constraint" },
      ],
      ["a bare not-found", { error: "Not found" }],
    ])("declines %s, whose error field is prose not a code", (_label, body) => {
      expect(readHandledError(body)).toBeNull();
    });
  });
});

describe("readErrorTraceId", () => {
  it("prefers the id inside the handled payload", () => {
    const traceId = readErrorTraceId(
      trpcError(
        { code: "x", httpStatus: 500, traceId: "from-payload" },
        "from-envelope",
      ),
    );

    expect(traceId).toBe("from-payload");
  });

  describe("given the failure was unhandled", () => {
    it("still finds the id, so support has something to correlate on", () => {
      const traceId = readErrorTraceId(trpcError(null, "from-envelope"));

      expect(traceId).toBe("from-envelope");
    });
  });

  describe("given a REST error body", () => {
    it("finds the id under trace, where that boundary puts it", () => {
      expect(
        readErrorTraceId({
          error: "Internal server error",
          trace: { traceId: "from-rest", spanId: "s-1" },
        }),
      ).toBe("from-rest");
    });
  });

  it("returns undefined rather than guessing when there is no id", () => {
    expect(readErrorTraceId({})).toBeUndefined();
    expect(readErrorTraceId(new Error("boom"))).toBeUndefined();
  });
});

describe("handledShapeFromSerialized", () => {
  /**
   * The type says these fields are present; the type is a promise about our
   * own code, not about the bytes on the wire. This is the path a relayed Go
   * error takes, and every field on it was parsed out of an upstream body.
   */
  describe("given a payload missing fields its type says are there", () => {
    it("defaults the fault rather than rendering the word undefined", () => {
      const shape = handledShapeFromSerialized({
        code: "provider_error",
        kind: "provider_error",
        httpStatus: 502,
        traceId: undefined,
        spanId: undefined,
        reasons: [],
      } as never);

      expect(shape.fault).toBe("customer");
    });

    it("defaults meta to an object every registry entry can read", () => {
      const shape = handledShapeFromSerialized({
        code: "provider_error",
        kind: "provider_error",
        httpStatus: 502,
        fault: "provider",
        traceId: undefined,
        spanId: undefined,
        reasons: [],
      } as never);

      expect(shape.meta).toEqual({});
    });
  });
});

describe("readAuthoredMessage", () => {
  // `authored` is stamped by the boundary (`src/server/api/trpc.ts`), which is
  // the only place that can tell copy from an accident — it needs `cause`, and
  // `cause` never crosses the wire. Default it on here so each test says what
  // it is actually about.
  const trpcError = (
    httpStatus: number,
    message: string,
    error: unknown = null,
    authored = true,
  ) => ({
    message,
    data: { httpStatus, error, authored },
  });

  describe("given a plain non-5xx TRPCError", () => {
    it("returns the prose the procedure authored", () => {
      // These are real: user.register throws them, and #5984 deliberately
      // left non-5xx messages alone.
      expect(readAuthoredMessage(trpcError(409, "User already exists"))).toBe(
        "User already exists",
      );
      expect(
        readAuthoredMessage(
          trpcError(429, "Too many signup attempts. Please try again later."),
        ),
      ).toBe("Too many signup attempts. Please try again later.");
    });
  });

  describe("given anything the registry or the generic state owns", () => {
    it("declines a handled error — its copy comes from the registry", () => {
      expect(
        readAuthoredMessage(
          trpcError(404, "trace_not_found", {
            code: "trace_not_found",
            httpStatus: 404,
          }),
        ),
      ).toBeUndefined();
    });

    it("declines a 5xx — its message can carry internals", () => {
      expect(
        readAuthoredMessage(trpcError(500, "connect ECONNREFUSED 10.0.0.4")),
      ).toBeUndefined();
    });

    it("declines anything shaped like a code slug", () => {
      expect(
        readAuthoredMessage(trpcError(422, "validation_error")),
      ).toBeUndefined();
    });

    it("declines a single-word code, which has no underscore to spot it by", () => {
      // The registry has several. Matching on shape alone let these through
      // and rendered a slug as though it were a sentence.
      for (const code of ["unauthorized", "not_found", "internal_error"]) {
        expect(readAuthoredMessage(trpcError(401, code)), code).toBeUndefined();
      }
    });

    it.each([
      ["no data", { message: "hi" }],
      ["no status", { message: "hi", data: {} }],
      ["no message", { data: { httpStatus: 400 } }],
      ["a bare Error", new Error("boom")],
    ])("declines %s", (_label, error) => {
      expect(readAuthoredMessage(error)).toBeUndefined();
    });
  });

  describe("given a 4xx the boundary did not mark as authored", () => {
    /**
     * The two accidents the flag exists to exclude. Both used to reach a
     * customer through this channel.
     */
    it("declines a message tRPC defaulted to the code NAME", () => {
      // `new TRPCError({ code: "NOT_FOUND" })` with no message: tRPC uses the
      // code name, so the customer read "NOT_FOUND".
      expect(
        readAuthoredMessage(trpcError(404, "NOT_FOUND", null, false)),
      ).toBeUndefined();
    });

    it("declines a message inherited from a wrapped cause", () => {
      // `new TRPCError({ code: "BAD_REQUEST", cause: err })` inherits the
      // caught error's message — a driver string, presented as our own copy.
      expect(
        readAuthoredMessage(trpcError(400, "fetch failed", null, false)),
      ).toBeUndefined();
      expect(
        readAuthoredMessage(trpcError(400, "Invalid time value", null, false)),
      ).toBeUndefined();
    });

    it("declines SCREAMING_CASE even if something marked it authored", () => {
      expect(readAuthoredMessage(trpcError(404, "NOT_FOUND"))).toBeUndefined();
    });
  });

  describe("given copy that merely reads like a machine wrote it", () => {
    /**
     * The second layer must not eat real copy. An earlier version matched SQL
     * keywords case-insensitively and would have suppressed every one of
     * these, silently, with no test to notice.
     */
    it.each([
      "Select a template from the list before running this.",
      "Delete the existing default before you set a new one.",
      "You can update this from the project settings page.",
      "This is only available at Enterprise (contact sales).",
      "The IP 10.0.0.1 is not allowed as a webhook destination.",
    ])("keeps %s", (message) => {
      expect(readAuthoredMessage(trpcError(400, message))).toBe(message);
    });

    it.each([
      ["a driver diagnostic", "Invalid `prisma.user.create()` invocation"],
      ["a socket errno", "connect ECONNREFUSED 10.0.0.4:5432"],
      ["a real SQL fragment", "SELECT id FROM traces WHERE project_id = $1"],
      ["a stack frame", "boom\n    at Object.handler (/app/index.js:1:1)"],
      ["a runtime error prefix", "TypeError: cannot read properties of null"],
    ])("still refuses %s", (_label, message) => {
      expect(readAuthoredMessage(trpcError(400, message))).toBeUndefined();
    });
  });
});
