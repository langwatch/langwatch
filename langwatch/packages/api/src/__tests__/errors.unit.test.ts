import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";

import { formatError, isHandledErrorLike } from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers -- fake HandledError-like object (duck-typed)
// ---------------------------------------------------------------------------

function makeHandledError(
  overrides: {
    code?: string;
    message?: string;
    httpStatus?: number;
    meta?: Record<string, unknown>;
    fault?: string;
    tips?: readonly string[];
    docsUrl?: string;
  } = {},
): Error & {
  code: string;
  httpStatus: number;
  meta: Record<string, unknown>;
  serialize: () => {
    code: string;
    meta: Record<string, unknown>;
    traceId: undefined;
    spanId: undefined;
    httpStatus: number;
    fault?: string;
    tips?: readonly string[];
    docsUrl?: string;
    reasons: Array<{ code: string }>;
  };
} {
  const code = overrides.code ?? "test_error";
  const httpStatus = overrides.httpStatus ?? 422;
  const meta = overrides.meta ?? {};
  const message = overrides.message ?? "Test error message";

  const error = new Error(message) as Error & {
    code: string;
    httpStatus: number;
    meta: Record<string, unknown>;
    serialize: () => {
      code: string;
      meta: Record<string, unknown>;
      traceId: undefined;
      spanId: undefined;
      httpStatus: number;
      reasons: Array<{ code: string }>;
    };
  };
  error.code = code;
  error.httpStatus = httpStatus;
  error.meta = meta;
  error.serialize = () => ({
    code,
    meta,
    traceId: undefined,
    spanId: undefined,
    httpStatus,
    ...(overrides.fault ? { fault: overrides.fault } : {}),
    ...(overrides.tips ? { tips: overrides.tips } : {}),
    ...(overrides.docsUrl ? { docsUrl: overrides.docsUrl } : {}),
    reasons: [],
  });

  return error;
}

// ---------------------------------------------------------------------------
// isHandledErrorLike
// ---------------------------------------------------------------------------

describe("isHandledErrorLike", () => {
  describe("when given a HandledError-like object", () => {
    it("returns true", () => {
      const err = makeHandledError();
      expect(isHandledErrorLike(err)).toBe(true);
    });
  });

  describe("when given a plain Error", () => {
    it("returns false", () => {
      expect(isHandledErrorLike(new Error("plain"))).toBe(false);
    });
  });

  describe("when given null", () => {
    it("returns false", () => {
      expect(isHandledErrorLike(null)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// formatError -- HandledError-like
// ---------------------------------------------------------------------------

describe("formatError", () => {
  describe("when given a HandledError-like error", () => {
    describe("when the request is versioned", () => {
      it("returns the new format without the error field", () => {
        const err = makeHandledError({
          code: "not_found",
          message: "Resource not found",
          httpStatus: 404,
          meta: { id: "abc" },
        });

        const { status, body } = formatError({ err, isVersioned: true });

        expect(status).toBe(404);
        expect(body.code).toBe("not_found");
        expect(body.message).toBe("Resource not found");
        expect(body.meta).toEqual({ id: "abc" });
        expect(body.error).toBeUndefined();
      });

      it("carries fault, tips and docsUrl when present", () => {
        const err = makeHandledError({
          code: "query_memory_exceeded",
          httpStatus: 422,
          fault: "customer",
          tips: ["Narrow the time range"],
          docsUrl: "https://docs.langwatch.ai/traces",
        });

        const { body } = formatError({ err, isVersioned: true });

        expect(body.fault).toBe("customer");
        expect(body.tips).toEqual(["Narrow the time range"]);
        expect(body.docsUrl).toBe("https://docs.langwatch.ai/traces");
      });

      it("omits remediation keys when absent", () => {
        const err = makeHandledError({ code: "not_found", httpStatus: 404 });

        const { body } = formatError({ err, isVersioned: true });

        expect(body.fault).toBeUndefined();
        expect(body.tips).toBeUndefined();
        expect(body.docsUrl).toBeUndefined();
      });
    });

    describe("when the request is unversioned", () => {
      it("returns the union format with the error field", () => {
        const err = makeHandledError({
          code: "not_found",
          message: "Resource not found",
          httpStatus: 404,
        });

        const { status, body } = formatError({ err, isVersioned: false });

        expect(status).toBe(404);
        expect(body.code).toBe("not_found");
        expect(body.error).toBe("Not Found");
      });
    });

    describe("back-compat `kind` alias", () => {
      it("emits `kind` equal to `code` for a HandledError (versioned)", () => {
        const err = makeHandledError({ code: "not_found", httpStatus: 404 });
        const { body } = formatError({ err, isVersioned: true });
        expect(body.kind).toBe("not_found");
        expect(body.kind).toBe(body.code);
      });

      it("emits `kind` for synthesized error bodies too", () => {
        const zodErr = (() => {
          try {
            z.object({ name: z.string() }).parse({});
            throw new Error("should not reach");
          } catch (e) {
            return e as ZodError;
          }
        })();
        expect(formatError({ err: zodErr, isVersioned: true }).body.kind).toBe(
          "validation_error",
        );
        expect(
          formatError({ err: new Error("oops"), isVersioned: true }).body.kind,
        ).toBe("internal_error");
      });
    });
  });

  // -------------------------------------------------------------------------
  // ZodError
  // -------------------------------------------------------------------------

  describe("when given a ZodError", () => {
    it("maps to validation_error with reasons per field", () => {
      const schema = z.object({
        name: z.string().min(1),
        age: z.number(),
      });

      let zodError: ZodError;
      try {
        schema.parse({ name: "", age: "not-a-number" });
        throw new Error("should not reach");
      } catch (err) {
        zodError = err as ZodError;
      }

      const { status, body } = formatError({
        err: zodError!,
        isVersioned: true,
      });

      expect(status).toBe(422);
      expect(body.code).toBe("validation_error");
      expect(body.message).toBe("Validation error");
      expect(body.reasons).toEqual(
        expect.arrayContaining([
          {
            code: "schema_failure",
            meta: expect.objectContaining({ field: "name", type: "too_small" }),
          },
          {
            code: "schema_failure",
            meta: expect.objectContaining({
              field: "age",
              type: "invalid_type",
            }),
          },
        ]),
      );
    });

    describe("when the request is unversioned", () => {
      it("includes the error field", () => {
        const schema = z.object({ name: z.string() });
        let zodError: ZodError;
        try {
          schema.parse({});
          throw new Error("should not reach");
        } catch (err) {
          zodError = err as ZodError;
        }

        const { body } = formatError({
          err: zodError!,
          isVersioned: false,
        });
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
    it("returns 500 with a sanitized message in non-dev mode", () => {
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      try {
        const err = new Error("secret internal details");
        const { status, body } = formatError({ err, isVersioned: true });

        expect(status).toBe(500);
        expect(body.code).toBe("internal_error");
        expect(body.message).toBe("An unknown error occurred");
      } finally {
        process.env["NODE_ENV"] = originalEnv;
      }
    });

    it("does not expose the error message in development mode", () => {
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";
      try {
        const err = new Error("secret internal details");
        const { status, body } = formatError({ err, isVersioned: true });

        expect(status).toBe(500);
        expect(body.code).toBe("internal_error");
        expect(body.message).toBe("An unknown error occurred");
      } finally {
        process.env["NODE_ENV"] = originalEnv;
      }
    });

    describe("when the request is unversioned", () => {
      it("includes the error field", () => {
        const err = new Error("oops");
        const { body } = formatError({ err, isVersioned: false });
        expect(body.error).toBe("Internal Server Error");
      });
    });
  });
});
