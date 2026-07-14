import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { DomainError } from "../../app-layer/domain-error";
import { nlpgoHandledErrorFrom } from "../goHandledError";

/** The exact envelope nlpgo returned for an unroutable provider prefix. */
const MISSING_PROVIDER_BODY = JSON.stringify({
  error: {
    type: "bad_request",
    message: "bad_request",
    meta: { reason: "missing_provider" },
    reasons: [{ type: "unknown", message: "unknown" }],
  },
});

function makeAPICallError({
  responseBody,
  statusCode = 400,
}: {
  responseBody: string | undefined;
  statusCode?: number;
}) {
  return new APICallError({
    message: "bad_request",
    url: "http://localhost:5561/go/proxy/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
  });
}

describe("nlpgoHandledErrorFrom", () => {
  describe("given an APICallError carrying nlpgo's handled-error envelope", () => {
    it("maps it to a DomainError keyed by meta.reason", () => {
      const error = nlpgoHandledErrorFrom(
        makeAPICallError({ responseBody: MISSING_PROVIDER_BODY }),
      );

      expect(error).not.toBeNull();
      expect(DomainError.isHandled(error)).toBe(true);
      expect(error?.kind).toBe("missing_provider");
      expect(error?.httpStatus).toBe(400);
      expect(error?.meta).toEqual({ reason: "missing_provider" });
    });

    it("falls back to the envelope type when meta.reason is absent", () => {
      const error = nlpgoHandledErrorFrom(
        makeAPICallError({
          responseBody: JSON.stringify({
            error: { type: "upstream_timeout", message: "upstream_timeout" },
          }),
          statusCode: 504,
        }),
      );

      expect(error?.kind).toBe("upstream_timeout");
      expect(error?.httpStatus).toBe(504);
    });
  });

  describe("given the APICallError is wrapped in a RetryError", () => {
    it("unwraps to the last attempt's envelope", () => {
      const inner = makeAPICallError({ responseBody: MISSING_PROVIDER_BODY });
      const retry = new RetryError({
        message: "retries exhausted",
        reason: "errorNotRetryable",
        errors: [inner],
      });

      expect(nlpgoHandledErrorFrom(retry)?.kind).toBe("missing_provider");
    });
  });

  describe("given errors without a handled envelope", () => {
    it("returns null for a non-JSON provider error body", () => {
      expect(
        nlpgoHandledErrorFrom(
          makeAPICallError({ responseBody: "<html>502 Bad Gateway</html>" }),
        ),
      ).toBeNull();
    });

    it("returns null for JSON that is not envelope-shaped", () => {
      expect(
        nlpgoHandledErrorFrom(
          makeAPICallError({
            responseBody: JSON.stringify({ error: "invalid model ID" }),
          }),
        ),
      ).toBeNull();
    });

    it("returns null for a plain Error", () => {
      expect(nlpgoHandledErrorFrom(new Error("boom"))).toBeNull();
    });
  });
});
