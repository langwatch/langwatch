import { HandledError, ValidationError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLNotEnabledError,
  LangWatchQLUnavailableError,
} from "~/server/analytics/lwql/errors";

import { canonicalErrorFor } from "../canonical-error";
import { InternalServerError } from "../errors";

class RetryableUnavailableError extends HandledError {
  constructor() {
    super("temporary_unavailable", "Try again later", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
    });
  }
}

describe("canonicalErrorFor", () => {
  describe("given a handled error with a 5xx status", () => {
    it("collapses to the opaque body instead of shipping its own code and message", () => {
      const { status, body } = canonicalErrorFor(new LangWatchQLUnavailableError());

      expect(status).toBe(503);
      expect(body.error.code).toBe("internal_error");
      expect(body.error.message).toBe("An unknown error occurred");
      expect(body.error.retryable).toBe(false);
      expect(body.error.message).not.toContain("LangWatchQL");
    });

    it("keeps an explicit retry signal while collapsing private detail", () => {
      const { body } = canonicalErrorFor(new RetryableUnavailableError());

      expect(body.error.code).toBe("internal_error");
      expect(body.error.message).toBe("An unknown error occurred");
      expect(body.error.retryable).toBe(true);
    });

    it("drops meta and the reason chain from the opaque body", () => {
      const { status, body } = canonicalErrorFor(
        new LangWatchQLUnavailableError({
          reasons: [new Error("ClickHouse at ch-internal-host:8123 refused")],
        }),
      );

      expect(status).toBe(503);
      expect(body.error.meta).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("ch-internal-host");
    });

    it("carries the request's trace and span ids when the request was traced", () => {
      // The collapse drops the class's own code/message/meta, not the
      // correlation handles — trace ids ride on the opaque body too.
      const { body } = canonicalErrorFor(new LangWatchQLUnavailableError(), {
        traceId: "trace-abc",
        spanId: "span-def",
      });

      expect(body.error.trace_id).toBe("trace-abc");
      expect(body.error.span_id).toBe("span-def");
    });
  });

  describe("given an unhandled error", () => {
    it("collapses a plain thrown error to the opaque body at 500", () => {
      const { status, body } = canonicalErrorFor(
        new Error("connection to prisma-host:5432 refused"),
      );

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
      expect(body.error.message).toBe("An unknown error occurred");
      expect(body.error.retryable).toBe(false);
      expect(body.error.message).not.toContain("prisma-host");
    });

    it("collapses an HttpError at 500 to the opaque body", () => {
      const { status, body } = canonicalErrorFor(
        new InternalServerError("connection to prisma-host:5432 refused"),
      );

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
      expect(body.error.message).toBe("An unknown error occurred");
      expect(body.error.message).not.toContain("prisma-host");
    });
  });

  describe("given a handled error with a 4xx status", () => {
    it("keeps shipping its own code and message", () => {
      const { status, body } = canonicalErrorFor(new LangWatchQLNotEnabledError());

      expect(status).toBe(403);
      expect(body.error.code).toBe("lwql_not_enabled");
      expect(body.error.message).toBe(
        "The LangWatchQL analytics SQL feature is not enabled for this project.",
      );
    });

    it("still remaps a validation_error to 400 regardless of the class's own httpStatus", () => {
      const { status, body } = canonicalErrorFor(
        new ValidationError("The query parameters didn't match the expected shape."),
      );

      expect(status).toBe(400);
      expect(body.error.code).toBe("validation_error");
    });

    it("publishes an explicit retry signal", () => {
      const { body } = canonicalErrorFor(
        new ValidationError("Try the request again", { retryable: true }),
      );

      expect(body.error.retryable).toBe(true);
    });

    it("preserves retryability for each exposed reason", () => {
      const { body } = canonicalErrorFor(
        new ValidationError("The request could not be completed", {
          reasons: [new ValidationError("The provider is busy", { retryable: true })],
        }),
      );

      expect(body.error.meta).toMatchObject({
        reasons: [{ code: "validation_error", retryable: true }],
      });
    });
  });
});
