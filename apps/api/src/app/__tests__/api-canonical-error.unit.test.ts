/**
 * The status a refusal reaches the caller at, for the two classes the
 * request boundary can fail in: intact but rejected on values (422), or
 * unreadable as a request at all (400). Asserted on `code`, never prose.
 */
import { RequestValidationError } from "@langwatch/api/rest";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { canonicalErrorFor } from "../api-canonical-error.ts";

/**
 * A `validation_error` raised at 400 rather than 422, which several module
 * contracts do. The envelope reconciles them; this stands in for all of them.
 */
class ContractValidationErrorAt400 extends HandledError {
  constructor() {
    super("validation_error", "Either an existing team or a new team name must be given", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ContractValidationErrorAt400";
  }
}

/** What the shared validator raises when a body could not be parsed at all. */
class MalformedBody extends HandledError {
  constructor() {
    super("malformed_request", "The request body could not be parsed.", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "MalformedBody";
  }
}

/** A refusal that carries a status and a sentence but no machine name. */
class StatusCarryingError extends Error {
  readonly status = 500;
  readonly error = "Internal Server Error";
}

/** A domain refusal that is neither class: its own code, its own 4xx. */
class FeatureNotEnabled extends HandledError {
  constructor() {
    super("lwql_not_enabled", "LangWatchQL is not enabled for this project.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "FeatureNotEnabled";
  }
}

/** A 5xx whose message names infrastructure no caller may read. */
class DatastoreUnavailable extends HandledError {
  constructor() {
    super("clickhouse_unavailable", "ClickHouse at ch-internal-host:8123 refused", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "DatastoreUnavailable";
  }
}

describe("canonicalErrorFor", () => {
  describe("given a request that arrived intact and was rejected on its values", () => {
    it("answers 422 for the refusal the shared REST validator raises", () => {
      const { status, body } = canonicalErrorFor(
        new RequestValidationError({
          target: "json",
          violations: [{ field: "name", type: "too_small", message: "Too short" }],
        }),
      );

      expect(status).toBe(422);
      expect(body.error.code).toBe("validation_error");
    });

    it("answers 422 for the refusal a tRPC procedure's zod failure is promoted to", () => {
      const { status, body } = canonicalErrorFor(new ValidationError("Validation error"));

      expect(status).toBe(422);
      expect(body.error.code).toBe("validation_error");
    });

    /** @scenario "A validation failure answers 422 whatever status its class named" */
    it("answers 422 even where the raising class named 400 for itself", () => {
      // The pin, and the whole reason the envelope holds one: one code cannot
      // be 422 on one family and 400 on the next.
      const { status, body } = canonicalErrorFor(new ContractValidationErrorAt400());

      expect(status).toBe(422);
      expect(body.error.code).toBe("validation_error");
    });

    /** @scenario "A validation failure answers 422 whatever status its class named" */
    it("classes the envelope as unprocessable rather than as a bad request", () => {
      const { body } = canonicalErrorFor(new ValidationError("Validation error"));

      expect(body.error.type).toBe("unprocessable_entity");
    });

    it("keeps the offending fields on the envelope so the caller learns where", () => {
      const { body } = canonicalErrorFor(
        new RequestValidationError({
          target: "query",
          violations: [{ field: "from", type: "invalid_type", message: "Expected a date" }],
        }),
      );

      expect(body.error.meta?.fields).toEqual(["from"]);
      expect(body.error.meta?.reasons).toMatchObject([{ code: "schema_failure" }]);
    });
  });

  describe("given a body that could not be read as a request at all", () => {
    it("answers 400, the status the raising class names", () => {
      const { status, body } = canonicalErrorFor(new MalformedBody());

      expect(status).toBe(400);
      expect(body.error.code).toBe("malformed_request");
    });

    it("classes the envelope as a bad request", () => {
      const { body } = canonicalErrorFor(new MalformedBody());

      expect(body.error.type).toBe("bad_request");
    });
  });

  describe("given a handled refusal that is neither class", () => {
    it("keeps shipping the status, code and message the class named", () => {
      const { status, body } = canonicalErrorFor(new FeatureNotEnabled());

      expect(status).toBe(403);
      expect(body.error.code).toBe("lwql_not_enabled");
    });
  });

  describe("given a handled refusal at a 5xx status", () => {
    it("collapses to the opaque body instead of shipping its own code and message", () => {
      const { status, body } = canonicalErrorFor(new DatastoreUnavailable());

      expect(status).toBe(503);
      expect(body.error.code).toBe("internal_error");
      expect(JSON.stringify(body)).not.toContain("ch-internal-host");
    });

    it("carries the request's trace and span ids on the opaque body", () => {
      const { body } = canonicalErrorFor(new DatastoreUnavailable(), {
        traceId: "trace-abc",
        spanId: "span-def",
      });

      expect(body.error.trace_id).toBe("trace-abc");
      expect(body.error.span_id).toBe("span-def");
    });
  });

  describe("given a failure nobody anticipated", () => {
    it("collapses a plain thrown error to the opaque body at 500", () => {
      const { status, body } = canonicalErrorFor(new Error("prisma-host:5432 refused"));

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
      expect(JSON.stringify(body)).not.toContain("prisma-host");
    });

    it("collapses a status-carrying error at 500 to the opaque body", () => {
      const { status, body } = canonicalErrorFor(new StatusCarryingError());

      expect(status).toBe(500);
      expect(body.error.code).toBe("internal_error");
    });
  });
});
