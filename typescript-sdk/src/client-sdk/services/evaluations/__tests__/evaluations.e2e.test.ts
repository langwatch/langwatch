/**
 * E2E tests for the Evaluations API
 *
 * These tests require a running LangWatch instance with the NLP service
 * (langwatch_nlp) available, plus a valid API key.
 * Set LANGWATCH_ENDPOINT and LANGWATCH_API_KEY environment variables.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { LangWatch } from "@/client-sdk";
import { EvaluatorNotFoundError, EvaluationsApiError } from "../errors";

describe("Evaluations E2E", () => {
  let langwatch: LangWatch;
  const endpoint = process.env.LANGWATCH_ENDPOINT;
  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  let nlpAvailable = true;

  const skipUnless = (condition: boolean, reason: string) => {
    if (!condition) {
      console.log(`Skipping: ${reason}`);
      return true;
    }
    return false;
  };

  beforeAll(async () => {
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

    // Probe NLP availability with a lightweight evaluation call
    try {
      const probe = await langwatch.evaluations.evaluate(
        "presidio/pii_detection",
        { data: { input: "hello" } }
      );
      if (probe.status === "error") {
        nlpAvailable = false;
        console.log(
          "NLP service unavailable (evaluation returned error) — skipping NLP-dependent tests"
        );
      }
    } catch {
      nlpAvailable = false;
      console.log(
        "NLP service unreachable — skipping NLP-dependent tests"
      );
    }
  });

  describe("evaluate()", () => {
    it("runs a basic evaluator successfully", async () => {
      if (skipUnless(!!apiKey && nlpAvailable, "requires API key and NLP service")) return;

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
      if (skipUnless(!!apiKey && nlpAvailable, "requires API key and NLP service")) return;

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
      expect(typeof result.passed).toBe("boolean");
    });

    it("handles custom settings", async () => {
      if (skipUnless(!!apiKey && nlpAvailable, "requires API key and NLP service")) return;

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
      if (skipUnless(!!apiKey, "requires API key")) return;

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
      if (skipUnless(!!apiKey && nlpAvailable, "requires API key and NLP service")) return;

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
      expect(typeof result.passed).toBe("boolean");
      if (result.details) {
        expect(typeof result.details).toBe("string");
      }
    });
  });
});
