import { describe, expect, it } from "vitest";

import { TestSuiteLimitExceededError } from "../license-enforcement.errors.ts";

describe("TestSuiteLimitExceededError", () => {
  /** @scenario "The suite cap refusal names its own error type in logs" */
  it("reports its own name in logs", () => {
    const error = new TestSuiteLimitExceededError(3, 3);

    expect(error.name).toBe("TestSuiteLimitExceededError");
    expect(error.meta.countedAs).toBe("testSuites");
  });
});
