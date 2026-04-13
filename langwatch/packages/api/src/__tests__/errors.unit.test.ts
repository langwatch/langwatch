import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";

import { formatError, isDomainErrorLike } from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers -- fake DomainError-like object (duck-typed)
// ---------------------------------------------------------------------------

function makeDomainError(overrides: {
  kind?: string;
  message?: string;
  httpStatus?: number;
  meta?: Record<string, unknown>;
} = {}): Error & {
  kind: string;
  httpStatus: number;
  meta: Record<string, unknown>;
  serialize: () => {
    kind: string;
    meta: Record<string, unknown>;
    telemetry: { traceId: undefined; spanId: undefined };
    httpStatus: number;
    reasons: Array<{ kind: string }>;
  };
} {
  const kind = overrides.kind ?? "test_error";
  const httpStatus = overrides.httpStatus ?? 422;
  const meta = overrides.meta ?? {};
  const message = overrides.message ?? "Test error message";

  const error = new Error(message) as Error & {
    kind: string;
    httpStatus: number;
    meta: Record<string, unknown>;
    serialize: () => {
      kind: string;
      meta: Record<string, unknown>;
      telemetry: { traceId: undefined; spanId: undefined };
      httpStatus: number;
      reasons: Array<{ kind: string }>;
    };
  };
  error.kind = kind;
  error.httpStatus = httpStatus;
  error.meta = meta;
  error.serialize = () => ({
    kind,
    meta,
    telemetry: { traceId: undefined, spanId: undefined },
    httpStatus,
    reasons: [],
  });

  return error;
}

// ---------------------------------------------------------------------------
// isDomainErrorLike
// ---------------------------------------------------------------------------

describe("isDomainErrorLike", () => {
  describe("when given a DomainError-like object", () => {
    it("returns true", () => {
      const err = makeDomainError();
      expect(isDomainErrorLike(err)).toBe(true);
    });
  });

  describe("when given a plain Error", () => {
    it("returns false", () => {
      expect(isDomainErrorLike(new Error("plain"))).toBe(false);
    });
  });

  describe("when given null", () => {
    it("returns false", () => {
      expect(isDomainErrorLike(null)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// formatError -- DomainError-like
// ---------------------------------------------------------------------------

describe("formatError", () => {
  describe("when given a DomainError-like error", () => {
    describe("when the request is versioned", () => {
      it("returns the new format without the error field", () => {
        const err = makeDomainError({
          kind: "not_found",
          message: "Resource not found",
          httpStatus: 404,
          meta: { id: "abc" },
        });

        const { status, body } = formatError(err, true);

        expect(status).toBe(404);
        expect(body.kind).toBe("not_found");
        expect(body.message).toBe("Resource not found");
        expect(body.meta).toEqual({ id: "abc" });
        expect(body.error).toBeUndefined();
      });
    });

    describe("when the request is unversioned", () => {
      it("returns the union format with the error field", () => {
        const err = makeDomainError({
          kind: "not_found",
          message: "Resource not found",
          httpStatus: 404,
        });

        const { status, body } = formatError(err, false);

        expect(status).toBe(404);
        expect(body.kind).toBe("not_found");
        expect(body.error).toBe("Not Found");
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

      const { status, body } = formatError(zodError!, true);

      expect(status).toBe(422);
      expect(body.kind).toBe("validation_error");
      expect(body.message).toBe("Validation error");
      expect(body.reasons).toEqual(
        expect.arrayContaining([
          {
            code: "schema_failure",
            meta: expect.objectContaining({ field: "name", type: "too_small" }),
          },
          {
            code: "schema_failure",
            meta: expect.objectContaining({ field: "age", type: "invalid_type" }),
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

        const { body } = formatError(zodError!, false);
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
      const { status, body } = formatError(err, true);

      expect(status).toBe(403);
      expect(body.kind).toBe("http_error");
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
        const { status, body } = formatError(err, true);

        expect(status).toBe(500);
        expect(body.kind).toBe("internal_error");
        expect(body.message).toBe("Internal server error");
      } finally {
        process.env["NODE_ENV"] = originalEnv;
      }
    });

    it("exposes the error message in development mode", () => {
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";
      try {
        const err = new Error("secret internal details");
        const { status, body } = formatError(err, true);

        expect(status).toBe(500);
        expect(body.kind).toBe("internal_error");
        expect(body.message).toBe("secret internal details");
      } finally {
        process.env["NODE_ENV"] = originalEnv;
      }
    });

    describe("when the request is unversioned", () => {
      it("includes the error field", () => {
        const err = new Error("oops");
        const { body } = formatError(err, false);
        expect(body.error).toBe("Internal Server Error");
      });
    });
  });
});
