/**
 * E2E tests for the Evaluations API
 *
 * These tests require a running LangWatch instance and valid API key.
 * Set LANGWATCH_ENDPOINT and LANGWATCH_API_KEY environment variables.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { LangWatch } from "@/client-sdk";
import { EvaluatorNotFoundError, EvaluationsApiError } from "../errors";

describe("Evaluations E2E", () => {
  let langwatch: LangWatch;
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";
  const apiKey = process.env.LANGWATCH_API_KEY ?? "";

  beforeAll(() => {
    if (!apiKey) {
      console.log(
        "Skipping E2E tests: LANGWATCH_API_KEY environment variable not set"
      );
      return;
    }

    langwatch = new LangWatch({
      endpoint,
      apiKey,
    });
  });

  describe("evaluate()", () => {
    it("runs a basic evaluator successfully", async () => {
      if (!apiKey) {
        console.log("Skipping: LANGWATCH_API_KEY not set");
        return;
      }

      // Run PII detection evaluator
      const result = await langwatch.evaluations.evaluate(
        "presidio/pii_detection",
        {
          data: {
            input: "Hello, how are you today?",
          },
          name: "E2E PII Detection Test",
        }
      );

      expect(result.status).toBe("processed");
      expect(typeof result.passed).toBe("boolean");
    });

    it("runs evaluator as guardrail", async () => {
      if (!apiKey) {
        console.log("Skipping: LANGWATCH_API_KEY not set");
        return;
      }

      const result = await langwatch.evaluations.evaluate(
        "presidio/pii_detection",
        {
          data: {
            input: "My email is test@example.com",
          },
          name: "E2E Guardrail Test",
          asGuardrail: true,
        }
      );

      expect(result.status).toBe("processed");
      // Guardrails should have passed property
      expect(typeof result.passed).toBe("boolean");
    });

    it("handles custom settings", async () => {
      if (!apiKey) {
        console.log("Skipping: LANGWATCH_API_KEY not set");
        return;
      }

      const result = await langwatch.evaluations.evaluate(
        "presidio/pii_detection",
        {
          data: {
            input: "Just a normal message without PII",
          },
          name: "E2E Settings Test",
          settings: {},
        }
      );

      expect(result.status).toBe("processed");
    });

    it("throws EvaluatorNotFoundError for non-existent evaluator", async () => {
      if (!apiKey) {
        console.log("Skipping: LANGWATCH_API_KEY not set");
        return;
      }

      const error = await langwatch.evaluations
        .evaluate("non-existent/evaluator-slug", {
          data: { input: "test" },
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(EvaluatorNotFoundError);
    });

    it("throws EvaluationsApiError for invalid API key", async () => {
      const invalidLangwatch = new LangWatch({
        endpoint,
        apiKey: "invalid-api-key",
      });

      const error = await invalidLangwatch.evaluations
        .evaluate("presidio/pii_detection", {
          data: { input: "test" },
        })
        .catch((e) => e);

      // Should get either API error or evaluator error
      expect(
        error instanceof EvaluationsApiError || error instanceof Error
      ).toBe(true);
    });

    it("returns valid result structure for PII detection", async () => {
      if (!apiKey) {
        console.log("Skipping: LANGWATCH_API_KEY not set");
        return;
      }

      // Test that the evaluator returns a valid result structure
      const result = await langwatch.evaluations.evaluate(
        "presidio/pii_detection",
        {
          data: {
            input: "My social security number is 123-45-6789",
          },
          name: "E2E PII Detection Structure Test",
          asGuardrail: true,
        }
      );

      expect(result.status).toBe("processed");
      // Guardrails should always return a passed property
      expect(typeof result.passed).toBe("boolean");
      // Details may or may not be present depending on the evaluator
      if (result.details) {
        expect(typeof result.details).toBe("string");
      }
    });
  });
});
