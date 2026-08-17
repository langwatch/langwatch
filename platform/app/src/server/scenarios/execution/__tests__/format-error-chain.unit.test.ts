import { describe, expect, it } from "vitest";

import { formatErrorWithCauses } from "../format-error-chain";

/**
 * Rebuilds the shape @langwatch/scenario throws around every agent call:
 *
 *   throw new Error(`[${agentName}] ${error}`, { cause: error })
 *
 * The wrapper's message therefore already contains the cause's full text.
 */
function wrapLikeScenarioLibrary(agentName: string, cause: Error): Error {
  return new Error(`[${agentName}] ${cause}`, { cause });
}

/** An AI SDK RetryError: no `cause`, the real failure on `lastError`. */
function aiRetryError(lastError: Error, attempts = 3): Error {
  const error = new Error(
    `Failed after ${attempts} attempts. Last error: ${lastError.message}`,
  );
  error.name = "AI_RetryError";
  Object.assign(error, {
    reason: "maxRetriesExceeded",
    errors: Array.from({ length: attempts }, () => lastError),
    lastError,
  });
  return error;
}

describe("formatErrorWithCauses", () => {
  describe("given an error whose message already contains its cause", () => {
    /** @scenario "A cause already quoted by its wrapper is stated once" */
    it("states the text once", () => {
      const cause = new Error("Cannot connect to API");
      const wrapped = wrapLikeScenarioLibrary("UserSimulatorAgent", cause);

      expect(formatErrorWithCauses(wrapped)).toBe(
        "[UserSimulatorAgent] Error: Cannot connect to API",
      );
    });
  });

  describe("given the exact chain that reached production", () => {
    /** @scenario "A cause already quoted by its wrapper is stated once" */
    it("reports the gateway failure once, not twice", () => {
      const apiCallError = new Error("gateway_unavailable");
      apiCallError.name = "AI_APICallError";
      Object.assign(apiCallError, {
        statusCode: 502,
        url: "http://langwatch-nlp-service/go/proxy/v1/chat/completions",
        responseBody:
          '{"error":{"type":"gateway_unavailable","code":"gateway_unavailable","message":"gateway_unavailable"}}',
        isRetryable: true,
      });
      const retryError = aiRetryError(apiCallError);
      const thrown = wrapLikeScenarioLibrary("UserSimulatorAgent", retryError);

      const formatted = formatErrorWithCauses(thrown);
      const duplicatedTail = "Failed after 3 attempts. Last error";

      expect(formatted.split(duplicatedTail).length - 1).toBe(1);
    });

    /** @scenario "The chain follows an SDK aggregate past its empty cause" */
    it("reaches the response body the classifier needs, past AI_RetryError's empty cause", () => {
      const apiCallError = new Error("gateway_unavailable");
      apiCallError.name = "AI_APICallError";
      Object.assign(apiCallError, { statusCode: 502 });
      const underlying = new Error(
        'Provider returned 429: {"error":{"type":"insufficient_quota"}}',
      );
      Object.assign(apiCallError, { cause: underlying });

      const thrown = wrapLikeScenarioLibrary(
        "UserSimulatorAgent",
        aiRetryError(apiCallError),
      );

      expect(formatErrorWithCauses(thrown)).toContain("insufficient_quota");
    });
  });

  describe("given an undici TLS failure", () => {
    it("keeps the reason and code from the cause", () => {
      const cause = new Error("self-signed certificate in certificate chain");
      Object.assign(cause, { code: "SELF_SIGNED_CERT_IN_CHAIN" });
      const fetchFailed = new Error("fetch failed", { cause });

      const formatted = formatErrorWithCauses(fetchFailed);

      expect(formatted).toContain("fetch failed");
      expect(formatted).toContain(
        "self-signed certificate in certificate chain",
      );
      expect(formatted).toContain("SELF_SIGNED_CERT_IN_CHAIN");
    });
  });

  describe("given an aggregate with no cause and no lastError", () => {
    /** @scenario "The chain follows an SDK aggregate past its empty cause" */
    it("follows the final attempt", () => {
      const error = new Error("all attempts failed");
      Object.assign(error, {
        errors: [new Error("first attempt"), new Error("Model not found: zzz")],
      });

      expect(formatErrorWithCauses(error)).toContain("Model not found: zzz");
    });
  });

  describe("given a cyclic cause chain", () => {
    /** @scenario "A cyclic cause chain terminates" */
    it("terminates", () => {
      const a = new Error("a");
      const b = new Error("b");
      Object.assign(a, { cause: b });
      Object.assign(b, { cause: a });

      expect(formatErrorWithCauses(a)).toBe("a: b");
    });
  });

  describe("given a thrown non-error", () => {
    it("stringifies it", () => {
      expect(formatErrorWithCauses("boom")).toBe("boom");
    });
  });
});
