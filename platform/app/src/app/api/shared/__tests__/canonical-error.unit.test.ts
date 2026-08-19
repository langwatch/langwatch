import { ValidationError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLNotEnabledError,
  LangWatchQLUnavailableError,
} from "~/server/analytics/lwql/errors";

import { canonicalErrorFor } from "../canonical-error";
import { InternalServerError } from "../errors";

describe("canonicalErrorFor", () => {
  describe("given a handled error with a 5xx status", () => {
    it("keeps its own code and message instead of collapsing to internal_error", () => {
      const { status, body } = canonicalErrorFor(
        new LangWatchQLUnavailableError(),
      );

      expect(status).toBe(503);
      expect(body.error.code).toBe("lwql_unavailable");
      expect(body.error.message).toBe(
        "The LangWatchQL analytics SQL API is not available on this deployment.",
      );
      // `type` is the status CLASS (apiErrorType), a separate axis from
      // `code`. 503 has no entry in API_ERROR_TYPE_BY_STATUS, so it falls
      // back to "internal_error" same as an unhandled 500 — that is correct
      // and orthogonal to this fix, which is about `code`/`message` surviving,
      // not about `type`.
      expect(body.error.type).toBe("internal_error");
    });

    it("preserves the reason chain in meta without leaking the reason's message", () => {
      const { status, body } = canonicalErrorFor(
        new LangWatchQLUnavailableError({
          reasons: [new Error("ClickHouse at ch-internal-host:8123 refused")],
        }),
      );

      expect(status).toBe(503);
      // A non-HandledError reason serializes to its opaque marker only
      // (`serializeReason`), so the chain's presence is on the wire while
      // the internal message is not.
      expect(body.error.meta).toMatchObject({
        reasons: [{ code: "unknown", kind: "unknown" }],
      });
      expect(JSON.stringify(body)).not.toContain("ch-internal-host");
    });

    it("carries the request's trace and span ids when the request was traced", () => {
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
    it("keeps shipping its own code and message, unaffected by the 5xx fix", () => {
      const { status, body } = canonicalErrorFor(
        new LangWatchQLNotEnabledError(),
      );

      expect(status).toBe(403);
      expect(body.error.code).toBe("lwql_not_enabled");
      expect(body.error.message).toBe(
        "The LangWatchQL analytics SQL feature is not enabled for this project.",
      );
    });

    it("still remaps a validation_error to 400 regardless of the class's own httpStatus", () => {
      const { status, body } = canonicalErrorFor(
        new ValidationError(
          "The query parameters didn't match the expected shape.",
        ),
      );

      expect(status).toBe(400);
      expect(body.error.code).toBe("validation_error");
    });
  });
});
