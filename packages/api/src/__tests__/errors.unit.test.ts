import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { type ZodError, z } from "zod";

import { createErrorHandler, formatError } from "../errors.ts";

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
function fakeContext() {
  const store = new Map<string, unknown>();

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
    it("returns the clean format", () => {
      const err = new NotFoundError("not_found", "Resource", "abc");

      const { status, body } = formatError({ err });

      expect(status).toBe(404);
      expect(body.code).toBe("not_found");
      // The code, never the handled error's own message: that is server copy
      // and can name internals (ADR-045). Identifying context is in `meta`.
      expect(body.message).toBe("not_found");
      expect(JSON.stringify(body)).not.toContain("Resource not found: abc");
      expect(body.meta).toEqual({ id: "abc" });
      expect(body.retryable).toBe(false);
    });

    /** @scenario "A known failure is normalised by Hono to a client-safe body" */
    it("answers the class's status and meta with the code as its message", () => {
      const err = new TestError(
        "conversation_not_owned",
        "This conversation belongs to someone else",
        {
          httpStatus: 403,
          meta: { conversationId: "conversation-1" },
        },
      );

      const { status, body } = formatError({ err });

      expect(status).toBe(403);
      expect(body).toMatchObject({
        code: "conversation_not_owned",
        message: "conversation_not_owned",
        meta: { conversationId: "conversation-1" },
      });
      expect(JSON.stringify(body)).not.toContain("belongs to someone else");
    });

    /** @scenario "A validation failure answers the status its class named" */
    it("answers a validation_error at the status its class named", () => {
      const err = new TestError("validation_error", "The name is taken", { httpStatus: 400 });

      const { status, body } = formatError({ err });

      expect(status).toBe(400);
      expect(body).toMatchObject({ code: "validation_error", type: "validation_error" });
    });

    /** @scenario "A handled error carries remediation for agent consumers" */
    it("keeps trusted handled remediation metadata lossless", () => {
      const err = new TestError("query_memory_exceeded", "Query used too much memory", {
        httpStatus: 422,
        fault: "customer",
        tips: ["Narrow the time range"],
        docsUrl: "https://docs.langwatch.ai/traces",
      });

      const { body } = formatError({ err });

      expect(body.fault).toBe("customer");
      expect(body.tips).toEqual(["Narrow the time range"]);
      expect(body.docsUrl).toBe("https://docs.langwatch.ai/traces");
    });

    it("carries an explicit retryability decision", () => {
      const err = new TestError("provider_unavailable", "Provider unavailable", {
        httpStatus: 503,
        retryable: true,
      });

      const { body } = formatError({ err });

      expect(body.retryable).toBe(true);
    });

    it("does not infer retryability from the HTTP status", () => {
      const err = new TestError("provider_unavailable", "Provider unavailable", {
        httpStatus: 503,
      });

      const { body } = formatError({ err });

      expect(body.retryable).toBe(false);
    });

    /**
     * The version-gated union envelope died with the bare alias (ADR 002 §5):
     * there is no request shape left that carries the legacy `error` field.
     */
    /** @scenario "A REST refusal carries its fields at the root of the body" */
    it("never carries the legacy error field", () => {
      const err = new NotFoundError("not_found", "Resource", "abc");

      const { body } = formatError({ err });

      expect(body).not.toHaveProperty("error");
      expect(body).toMatchObject({
        code: "not_found",
        type: "not_found",
        message: "not_found",
        retryable: false,
      });
    });

    describe("given the back-compat `kind` alias", () => {
      /** @scenario "An external contract wins over cross-transport symmetry" */
      it("emits `kind` equal to `code`", () => {
        const err = new NotFoundError("not_found", "Resource", "abc");
        const { body } = formatError({ err });
        expect(body.kind).toBe("not_found");
        expect(body.kind).toBe(body.code);
        expect(body).not.toHaveProperty("error");
      });

      it("emits `kind` for synthesized error bodies too", () => {
        const zodErr = zodErrorFrom(() => z.object({ name: z.string() }).parse({}));
        expect(formatError({ err: zodErr }).body.kind).toBe("validation_error");
        expect(formatError({ err: new Error("oops") }).body.kind).toBe("internal_error");
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

      const { status, body } = formatError({ err: impostor });

      expect(status).toBe(500);
      expect(body.code).toBe("internal_error");
      expect(body.message).toBe("An unknown error occurred");
    });

    it("does not trust a copied handled brand without the trusted serializer", () => {
      const impostor = Object.assign(new Error("not really handled"), {
        isHandled: true,
        code: "malicious_error",
        docsUrl: "https://not-langwatch.example",
      });

      const { status, body } = formatError({ err: impostor });

      expect(status).toBe(500);
      expect(body).toMatchObject({ code: "internal_error", retryable: false });
      expect(JSON.stringify(body)).not.toContain("not-langwatch.example");
    });

    it("does not call a serializer supplied by a branded impostor", () => {
      const serialize = vi.fn(() => ({
        code: "malicious_error",
        docsUrl: "https://not-langwatch.example",
        httpStatus: 418,
        meta: { leaked: "credential" },
        reasons: [],
        retryable: false,
      }));

      const impostor = Object.assign(new Error("not really handled"), {
        isHandled: true,
        serialize,
      });

      const { status, body } = formatError({ err: impostor });

      expect(serialize).not.toHaveBeenCalled();
      expect(status).toBe(500);
      expect(body).toMatchObject({ code: "internal_error", retryable: false });
      expect(JSON.stringify(body)).not.toContain("credential");
      expect(JSON.stringify(body)).not.toContain("not-langwatch.example");
    });

    it("bypasses an overridden serializer on a registry-issued error", () => {
      class OverriddenSerializerError extends TestError {
        override serialize(): never {
          throw new Error("override must not run");
        }
      }

      const { status, body } = formatError({
        err: new OverriddenSerializerError("trusted_error", "server copy", {
          httpStatus: 409,
          meta: { field: "name" },
        }),
      });

      expect(status).toBe(409);
      expect(body).toMatchObject({ code: "trusted_error", meta: { field: "name" } });
    });

    it("degrades non-JSON metadata and invalid handled statuses to an internal error", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const invalidMeta = new TestError("trusted_error", "server copy", {
        httpStatus: 409,
        meta: circular,
      });

      const invalidStatus = new TestError("trusted_error", "server copy", {
        httpStatus: 200,
      });

      expect(formatError({ err: invalidMeta })).toMatchObject({
        status: 500,
        body: { code: "internal_error" },
      });

      expect(formatError({ err: invalidStatus })).toMatchObject({
        status: 500,
        body: { code: "internal_error" },
      });
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

      const { status, body } = formatError({ err: zodError });

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
      const zodError = zodErrorFrom(() => z.object({ name: z.string() }).parse({}));

      const { body } = formatError({ err: zodError });

      expect(body.fault).toBe("customer");
    });
  });

  // -------------------------------------------------------------------------
  // Error with status property
  // -------------------------------------------------------------------------

  describe("when given an Error with a status property", () => {
    /** @scenario "A framework refusal keeps the status it was raised with" */
    it("keeps the status of the framework's own refusal", () => {
      const err = new HTTPException(404, { message: "No such route here" });

      const { status, body } = formatError({ err });

      expect(status).toBe(404);
      expect(body).toMatchObject({ code: "http_error", message: "http_error" });
      expect(JSON.stringify(body)).not.toContain("No such route");
    });

    /** @scenario "A framework refusal raised through a second copy of the framework is still a refusal" */
    it("keeps the status of a refusal from another copy of the framework", () => {
      class ForeignHTTPException extends Error {
        constructor(readonly status: number) {
          super("Not Found from a second copy");
        }
      }

      const { status, body } = formatError({ err: new ForeignHTTPException(404) });

      expect(status).toBe(404);
      expect(body).toMatchObject({ code: "http_error", message: "http_error" });
    });

    /** @scenario "A framework refusal at 5xx still collapses to the generic body" */
    it("collapses a 5xx framework refusal to internal_error", () => {
      const err = new HTTPException(503, { message: "Upstream pool drained" });

      const { status, body } = formatError({ err });

      expect(status).toBe(503);
      expect(body).toMatchObject({ code: "internal_error", message: "internal_error" });
      expect(JSON.stringify(body)).not.toContain("Upstream pool");
    });

    it("uses the status as the HTTP code", () => {
      const err = Object.assign(new Error("Forbidden"), { status: 403 });
      const { status, body } = formatError({ err });

      expect(status).toBe(403);
      expect(body.code).toBe("http_error");
      expect(body.message).toBe("http_error");
      expect(body.retryable).toBe(false);
    });

    it("does not expose an adapter-provided HTTP error message", () => {
      const err = Object.assign(new Error("upstream returned a customer token"), {
        status: 400,
      });

      const { body } = formatError({ err });

      expect(body.message).toBe("http_error");
      expect(JSON.stringify(body)).not.toContain("customer token");
    });

    it("does not trust an invalid status property", () => {
      const err = Object.assign(new Error("not a status"), { status: 999 });

      const { status, body } = formatError({ err });

      expect(status).toBe(500);
      expect(body).toMatchObject({ code: "internal_error", retryable: false });
    });
  });

  // -------------------------------------------------------------------------
  // Unknown errors
  // -------------------------------------------------------------------------

  describe("when given an unknown error", () => {
    it.each(["production", "development"])(
      "returns 500 with a sanitized message in %s",
      (nodeEnv) => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = nodeEnv;

        try {
          const err = new Error("secret internal details");
          const { status, body } = formatError({ err });

          expect(status).toBe(500);
          expect(body.code).toBe("internal_error");
          expect(body.message).toBe("An unknown error occurred");
          expect(body.retryable).toBe(false);
        } finally {
          process.env.NODE_ENV = originalEnv;
        }
      },
    );
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

      void handler(err, c as never);

      expect(c._store.get("resolvedError")).toMatchObject({
        status: 500,
        error: err,
      });
    });

    it("does not leak the cause into the response", async () => {
      const handler = createErrorHandler();
      const context = new Context(new Request("http://localhost/api/things", { method: "POST" }));

      const res = await handler(new Error("secret internal details"), context);

      await expect(res.json()).resolves.toMatchObject({ message: "An unknown error occurred" });
    });
  });

  describe("when the error is handled", () => {
    it("publishes the error and the status it sent", () => {
      const handler = createErrorHandler();
      const err = new NotFoundError("not_found", "Resource", "abc");
      const c = fakeContext();

      void handler(err as Error, c as never);

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

      void handler(err as Error, c as never);

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
      const zodError = zodErrorFrom(() => z.object({ name: z.string() }).parse({}));
      const c = fakeContext();

      void handler(zodError, c as never);

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
