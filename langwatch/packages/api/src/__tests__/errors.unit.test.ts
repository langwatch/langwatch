import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";

import { createErrorHandler, formatError } from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A concrete HandledError, since the base class is abstract. */
class TestError extends HandledError {
  constructor(
    code: string,
    message: string,
    options: ConstructorParameters<typeof HandledError>[2] = {},
  ) {
    super(code, message, options);
    this.name = "TestError";
  }
}

function zodErrorFrom(parse: () => unknown): ZodError {
  try {
    parse();
    throw new Error("expected a ZodError");
  } catch (err) {
    return err as ZodError;
  }
}

/** Minimal Hono-ish context for the error handler. */
function fakeContext(overrides: { isVersioned?: boolean } = {}) {
  const store = new Map<string, unknown>();
  if (overrides.isVersioned) store.set("isVersionedRequest", true);
  return {
    req: { method: "POST", path: "/api/things" },
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => store.set(key, value),
    json: (body: unknown, status: number) => ({ body, status }),
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// formatError -- HandledError
// ---------------------------------------------------------------------------

describe("formatError", () => {
  describe("when given a HandledError", () => {
    describe("when the request is versioned", () => {
      it("returns the new format without the error field", () => {
        const err = new NotFoundError("not_found", "Resource", "abc");

        const { status, body } = formatError({ err, isVersioned: true });

        expect(status).toBe(404);
        expect(body.code).toBe("not_found");
        // The code, never the handled error's own message: that is server copy
        // and can name internals (ADR-045). Identifying context is in `meta`.
        expect(body.message).toBe("not_found");
        expect(JSON.stringify(body)).not.toContain("Resource not found: abc");
        expect(body.meta).toEqual({ id: "abc" });
        expect(body.error).toBeUndefined();
      });

      it("carries fault, tips and docsUrl when present", () => {
        const err = new TestError(
          "query_memory_exceeded",
          "Query used too much memory",
          {
            httpStatus: 422,
            fault: "customer",
            tips: ["Narrow the time range"],
            docsUrl: "https://docs.langwatch.ai/traces",
          },
        );

        const { body } = formatError({ err, isVersioned: true });

        expect(body.fault).toBe("customer");
        expect(body.tips).toEqual(["Narrow the time range"]);
        expect(body.docsUrl).toBe("https://docs.langwatch.ai/traces");
      });
    });

    describe("when the request is unversioned", () => {
      it("returns the union format with the error field", () => {
        const err = new NotFoundError("not_found", "Resource", "abc");

        const { status, body } = formatError({ err, isVersioned: false });

        expect(status).toBe(404);
        expect(body.code).toBe("not_found");
        expect(body.error).toBe("Not Found");
      });
    });

    describe("back-compat `kind` alias", () => {
      it("emits `kind` equal to `code`", () => {
        const err = new NotFoundError("not_found", "Resource", "abc");
        const { body } = formatError({ err, isVersioned: true });
        expect(body.kind).toBe("not_found");
        expect(body.kind).toBe(body.code);
      });

      it("emits `kind` for synthesized error bodies too", () => {
        const zodErr = zodErrorFrom(() =>
          z.object({ name: z.string() }).parse({}),
        );
        expect(formatError({ err: zodErr, isVersioned: true }).body.kind).toBe(
          "validation_error",
        );
        expect(
          formatError({ err: new Error("oops"), isVersioned: true }).body.kind,
        ).toBe("internal_error");
      });
    });
  });

  describe("when given an object that merely looks like a HandledError", () => {
    it("treats it as unknown rather than trusting its serialize()", () => {
      // The framework used to duck-type. It no longer does: only real
      // HandledError instances get to choose their own status and body.
      const impostor = Object.assign(new Error("nope"), {
        code: "not_found",
        httpStatus: 404,
        meta: {},
        serialize: () => ({ code: "not_found", httpStatus: 404, reasons: [] }),
      });

      const { status, body } = formatError({ err: impostor, isVersioned: true });

      expect(status).toBe(500);
      expect(body.code).toBe("internal_error");
      expect(body.message).toBe("An unknown error occurred");
    });
  });

  // -------------------------------------------------------------------------
  // ZodError
  // -------------------------------------------------------------------------

  describe("when given a ZodError", () => {
    it("maps to validation_error with a reason per field", () => {
      const zodError = zodErrorFrom(() =>
        z
          .object({ name: z.string().min(1), age: z.number() })
          .parse({ name: "", age: "not-a-number" }),
      );

      const { status, body } = formatError({ err: zodError, isVersioned: true });

      expect(status).toBe(422);
      expect(body.code).toBe("validation_error");
      expect(body.message).toBe("validation_error");
      expect(body.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "schema_failure",
            meta: expect.objectContaining({ field: "name", type: "too_small" }),
          }),
          expect.objectContaining({
            code: "schema_failure",
            meta: expect.objectContaining({
              field: "age",
              type: "invalid_type",
            }),
          }),
        ]),
      );
    });

    it("gains the remediation channel by travelling as a HandledError", () => {
      // Before, the ZodError branch built a bare payload and validation errors
      // silently missed fault/tips/docsUrl entirely.
      const zodError = zodErrorFrom(() =>
        z.object({ name: z.string() }).parse({}),
      );

      const { body } = formatError({ err: zodError, isVersioned: true });

      expect(body.fault).toBe("customer");
    });

    describe("when the request is unversioned", () => {
      it("includes the error field", () => {
        const zodError = zodErrorFrom(() =>
          z.object({ name: z.string() }).parse({}),
        );

        const { body } = formatError({ err: zodError, isVersioned: false });
        expect(body.error).toBe("Unprocessable Entity");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Error with status property
  // -------------------------------------------------------------------------

  describe("when given an Error with a status property", () => {
    it("uses the status as the HTTP code", () => {
      const err = Object.assign(new Error("Forbidden"), { status: 403 });
      const { status, body } = formatError({ err, isVersioned: true });

      expect(status).toBe(403);
      expect(body.code).toBe("http_error");
      expect(body.message).toBe("Forbidden");
    });
  });

  // -------------------------------------------------------------------------
  // Unknown errors
  // -------------------------------------------------------------------------

  describe("when given an unknown error", () => {
    it.each(["production", "development"])(
      "returns 500 with a sanitized message in %s",
      (nodeEnv) => {
        const originalEnv = process.env["NODE_ENV"];
        process.env["NODE_ENV"] = nodeEnv;
        try {
          const err = new Error("secret internal details");
          const { status, body } = formatError({ err, isVersioned: true });

          expect(status).toBe(500);
          expect(body.code).toBe("internal_error");
          expect(body.message).toBe("An unknown error occurred");
        } finally {
          process.env["NODE_ENV"] = originalEnv;
        }
      },
    );

    describe("when the request is unversioned", () => {
      it("includes the error field", () => {
        const err = new Error("oops");
        const { body } = formatError({ err, isVersioned: false });
        expect(body.error).toBe("Internal Server Error");
      });
    });
  });
});

// ---------------------------------------------------------------------------
// createErrorHandler -- resolved error handoff
// ---------------------------------------------------------------------------

describe("createErrorHandler", () => {
  describe("when the error is unhandled", () => {
    it("publishes it with the 500 it sent", () => {
      const handler = createErrorHandler();
      const err = new Error("secret internal details");
      const c = fakeContext();

      handler(err, c as never);

      expect(c._store.get("resolvedError")).toMatchObject({
        status: 500,
        error: err,
      });
    });

    it("does not leak the cause into the response", () => {
      const handler = createErrorHandler();

      const res = handler(
        new Error("secret internal details"),
        fakeContext() as never,
      ) as unknown as { body: { message: string } };

      expect(res.body.message).toBe("An unknown error occurred");
    });
  });

  describe("when the error is handled", () => {
    it("publishes the error and the status it sent", () => {
      const handler = createErrorHandler();
      const err = new NotFoundError("not_found", "Resource", "abc");
      const c = fakeContext();

      handler(err as Error, c as never);

      expect(c._store.get("resolvedError")).toMatchObject({
        status: 404,
        error: err,
      });
    });

    it("carries the traceId through for the request logger", () => {
      const handler = createErrorHandler();
      const err = new TestError("upstream_down", "Upstream is down", {
        httpStatus: 502,
        fault: "provider",
      });
      (err as { traceId?: string }).traceId = "trace-abc";
      const c = fakeContext();

      handler(err as Error, c as never);

      expect(c._store.get("resolvedError")).toMatchObject({
        status: 502,
        traceId: "trace-abc",
      });
    });
  });

  describe("when the error is a ZodError", () => {
    it("publishes the promoted ValidationError and the 422 the caller received", () => {
      // Regression: a bare ZodError has no `httpStatus`, so the request logger
      // derived 500 and logged at error while the response went out 422.
      const handler = createErrorHandler();
      const zodError = zodErrorFrom(() =>
        z.object({ name: z.string() }).parse({}),
      );
      const c = fakeContext();

      handler(zodError as unknown as Error, c as never);

      const resolved = c._store.get("resolvedError") as {
        status: number;
        error: HandledError;
      };
      expect(resolved.status).toBe(422);
      expect(HandledError.isHandled(resolved.error)).toBe(true);
      expect(resolved.error.code).toBe("validation_error");
      expect(resolved.error.fault).toBe("customer");
    });
  });
});
