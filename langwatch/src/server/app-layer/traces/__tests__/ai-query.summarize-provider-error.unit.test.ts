/**
 * Unit coverage for `summarizeProviderError` — the curation step that turns
 * raw SDK/provider exceptions into the operator-actionable detail rows the Ask
 * AI composer shows behind "View details". Regression anchor: Azure's bare
 * "Resource not found" used to produce `{}`, leaving the operator with nothing
 * to act on.
 *
 * It deliberately produces no headline AND no prose. The words a customer reads
 * come from the `ai_query_provider_error` entry in the presentation registry;
 * everything this function returns is a value from a known set — a status code,
 * a vendor name matched against a fixed list, a model id.
 *
 * That last part is the point of half the tests below. This used to return a
 * `reason` scraped out of the provider's failure body with
 * `/['"]message['"][:\s]+['"](…)['"]/`, and `"message"` is the field OpenAI
 * fills with `Incorrect API key provided: sk-proj-…`. On a LangWatch-managed
 * provider that key is ours, so the disclosure was one 401 away from printing a
 * platform credential — and an earlier version of this very file asserted the
 * extraction worked, quoting that sentence, which is how it survived review.
 */
import { describe, expect, it } from "vitest";

import { summarizeProviderError } from "../ai-query";

class FakeApiCallError extends Error {
  statusCode: number;
  responseBody: string;
  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

describe("summarizeProviderError", () => {
  describe("when the SDK error carries structured statusCode/responseBody", () => {
    it("uses the structured status and names the resolved model", () => {
      const err = new FakeApiCallError("Resource not found", 404, "");
      const out = summarizeProviderError(err, { model: "azure/gpt-5.4-mini" });

      expect(out).toMatchObject({
        httpStatus: 404,
        model: "azure/gpt-5.4-mini",
        provider: "azure",
      });
    });

    it("takes no reason from a JSON responseBody", () => {
      const err = new FakeApiCallError(
        "Resource not found",
        404,
        '{"error":{"message":"The API deployment for this resource does not exist"}}',
      );
      const out = summarizeProviderError(err, { model: "azure/gpt-5.4-mini" });

      // A benign message, deliberately: the rule is that no provider prose is
      // extracted, not that the credential-shaped ones are filtered out. A test
      // using a key-bearing fixture would still pass against a scrubber.
      expect(out.reason).toBeUndefined();
      expect(out.httpStatus).toBe(404);
    });
  });

  describe("when the error is only a text blob", () => {
    it("still surfaces the resolved model, without the raw first line", () => {
      const out = summarizeProviderError(new Error("Resource not found"), {
        model: "azure/gpt-5.4-mini",
      });

      expect(out.model).toBe("azure/gpt-5.4-mini");
      expect(out.reason).toBeUndefined();
    });

    it("keeps litellm-style extraction of the structured fields", () => {
      const out = summarizeProviderError(
        new Error(
          'litellm.AuthenticationError: OpenAIException - {"message": "Incorrect API key provided", "status_code: 401"}',
        ),
      );

      // Provider and status still come through — they are what tells an
      // operator which configured model to go fix, and neither can carry a key.
      expect(out.provider).toBe("openai");
      expect(out.httpStatus).toBe(401);
    });

    it("never returns the provider's own sentence, even when it holds a key", () => {
      const out = summarizeProviderError(
        new Error(
          'litellm.AuthenticationError: OpenAIException - {"message": "Incorrect API key provided: sk-proj-NOT-A-REAL-KEY. You can find your API key at https://platform.openai.com/account/api-keys.", "status_code: 401"}',
        ),
      );

      expect(JSON.stringify(out)).not.toContain("sk-proj-");
      expect(JSON.stringify(out)).not.toContain("Incorrect API key");
      expect(out.reason).toBeUndefined();
    });
  });

  describe("when nothing is parseable", () => {
    it("returns no details rather than throwing", () => {
      expect(summarizeProviderError(null)).toEqual({});
    });
  });
});
