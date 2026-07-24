/**
 * Unit coverage for `summarizeProviderError` — the curation step that
 * turns raw SDK/provider exceptions into the operator-actionable error
 * the Ask AI composer renders. Regression anchor: Azure's bare
 * "Resource not found" used to produce `details: {}` and a message that
 * named neither the model nor the status, leaving the operator with
 * nothing to act on.
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

      expect(out.code).toBe("provider_error");
      expect(out.message).toBe("Provider returned 404 for azure/gpt-5.4-mini");
      expect(out.details).toMatchObject({
        httpStatus: 404,
        model: "azure/gpt-5.4-mini",
        provider: "azure",
      });
    });

    it("extracts the reason from a JSON responseBody", () => {
      const err = new FakeApiCallError(
        "Resource not found",
        404,
        '{"error":{"message":"The API deployment for this resource does not exist"}}',
      );
      const out = summarizeProviderError(err, { model: "azure/gpt-5.4-mini" });

      expect(out.message).toBe(
        "Provider returned 404 for azure/gpt-5.4-mini: The API deployment for this resource does not exist",
      );
      expect(out.details?.reason).toBe(
        "The API deployment for this resource does not exist",
      );
    });
  });

  describe("when the error is only a text blob", () => {
    it("still surfaces the resolved model alongside the raw first line", () => {
      const out = summarizeProviderError(new Error("Resource not found"), {
        model: "azure/gpt-5.4-mini",
      });

      expect(out.message).toBe("Resource not found for azure/gpt-5.4-mini");
      expect(out.details?.model).toBe("azure/gpt-5.4-mini");
    });

    it("keeps litellm-style extraction working without model context", () => {
      const out = summarizeProviderError(
        new Error(
          'litellm.AuthenticationError: OpenAIException - {"message": "Incorrect API key provided", "status_code: 401"}',
        ),
      );

      expect(out.details?.provider).toBe("openai");
      expect(out.details?.httpStatus).toBe(401);
      expect(out.message).toContain("Incorrect API key provided");
    });
  });

  describe("when nothing is parseable", () => {
    it("falls back to a generic message without throwing", () => {
      const out = summarizeProviderError(null);
      expect(out.code).toBe("provider_error");
      expect(out.message).toBe("Couldn't reach the model provider");
      expect(out.details).toEqual({});
    });
  });
});
