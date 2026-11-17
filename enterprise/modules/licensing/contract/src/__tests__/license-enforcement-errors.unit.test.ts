import { describe, expect, it } from "vitest";

import { TestSuiteLimitExceededError } from "../license-enforcement.errors.ts";

describe("TestSuiteLimitExceededError", () => {
  it("reports its own name in logs", () => {
    const error = new TestSuiteLimitExceededError(3, 3);

    expect(error.name).toBe("TestSuiteLimitExceededError");
    expect(error.meta.countedAs).toBe("testSuites");
  });
});
