/**
 * Unit coverage for `summarizeProviderError` — the curation step that turns
 * raw SDK/provider exceptions into the operator-actionable detail rows the Ask
 * AI composer shows behind "View details". Regression anchor: Azure's bare
 * "Resource not found" used to produce `{}`, leaving the operator with nothing
 * to act on.
 *
 * It deliberately produces no headline. The words a customer reads come from
 * the `ai_query_provider_error` entry in the presentation registry — a
 * provider's own sentence is diagnostic detail, never our copy.
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

    it("extracts the reason from a JSON responseBody", () => {
      const err = new FakeApiCallError(
        "Resource not found",
        404,
        '{"error":{"message":"The API deployment for this resource does not exist"}}',
      );
      const out = summarizeProviderError(err, { model: "azure/gpt-5.4-mini" });

      expect(out.reason).toBe(
        "The API deployment for this resource does not exist",
      );
    });
  });

  describe("when the error is only a text blob", () => {
    it("still surfaces the resolved model alongside the raw first line", () => {
      const out = summarizeProviderError(new Error("Resource not found"), {
        model: "azure/gpt-5.4-mini",
      });

      expect(out.model).toBe("azure/gpt-5.4-mini");
      expect(out.reason).toBe("Resource not found");
    });

    it("keeps litellm-style extraction working without model context", () => {
      const out = summarizeProviderError(
        new Error(
          'litellm.AuthenticationError: OpenAIException - {"message": "Incorrect API key provided", "status_code: 401"}',
        ),
      );

      expect(out.provider).toBe("openai");
      expect(out.httpStatus).toBe(401);
      expect(out.reason).toContain("Incorrect API key provided");
    });
  });

  describe("when nothing is parseable", () => {
    it("returns no details rather than throwing", () => {
      expect(summarizeProviderError(null)).toEqual({});
    });
  });
});
