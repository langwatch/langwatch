import { describe, expect, it } from "vitest";

import { isLLMErrorType, llmErrorTypeFromStatus } from "../prompt.llm-error.ts";

describe("llmErrorTypeFromStatus", () => {
  it.each([
    [401, "auth"],
    [403, "auth"],
    [402, "out_of_credit"],
    [404, "not_found"],
    [429, "rate_limit"],
    [400, "bad_request"],
    [422, "bad_request"],
    [500, "unknown"],
  ] as const)("maps %i to %s", (status, type) => {
    expect(llmErrorTypeFromStatus(status)).toBe(type);
  });
});

describe("isLLMErrorType", () => {
  it("recognises an out-of-credit failure off the wire", () => {
    expect(isLLMErrorType("out_of_credit")).toBe(true);
  });
});
