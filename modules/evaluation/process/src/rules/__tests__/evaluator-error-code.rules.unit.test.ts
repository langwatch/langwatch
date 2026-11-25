/** @see modules/evaluation/specs/evaluator-outcome-counts.feature */
import { describe, expect, it } from "vitest";

import {
  EVALUATOR_ERROR_CODE_PATTERNS,
  evaluatorErrorCodeOf,
} from "../evaluator-error-code.rules.ts";

const closedSet = new Set([...EVALUATOR_ERROR_CODE_PATTERNS.map(([code]) => code), "other"]);

describe("evaluatorErrorCodeOf", () => {
  /** @scenario "An error message never reaches the answer" */
  it("reduces content-bearing messages to a closed-set code", () => {
    const messages = [
      "Request timed out after 30000ms while judging: 'my password is hunter2'",
      'Error code: 429 - {"error": {"message": "Rate limit reached for gpt-5"}}',
      "Incorrect API key provided: sk-example",
      "The user asked: How do I cancel my order 1234?",
      "Evaluator input is too large, shorten the text sent to this evaluator",
      "answer is required for ragas/faithfulness evaluator",
      "Service Unavailable (503)",
    ];
    const codes = messages.map((message) => evaluatorErrorCodeOf(message));

    expect(codes).toEqual([
      "timeout",
      "rate_limited",
      "provider_auth",
      "other",
      "evaluator_input_too_large",
      "evaluator_missing_field",
      "evaluator_unavailable",
    ]);
    for (const [index, code] of codes.entries()) {
      expect(closedSet.has(code)).toBe(true);
      expect(code).not.toBe(messages[index]);
    }
  });

  /** @scenario "A message that is already a plain code keeps it" */
  it("keeps a message that is already a plain snake_case code", () => {
    expect(evaluatorErrorCodeOf("missing_model_provider")).toBe("missing_model_provider");
    expect(evaluatorErrorCodeOf("timeout")).toBe("timeout");
  });

  it("reads anything else, an empty or missing message included, as other", () => {
    expect(evaluatorErrorCodeOf(null)).toBe("other");
    expect(evaluatorErrorCodeOf("")).toBe("other");
    expect(evaluatorErrorCodeOf("Missing_Model")).toBe("other");
    expect(evaluatorErrorCodeOf(`${"a".repeat(49)}`)).toBe("other");
  });
});
