import { describe, expect, it } from "vitest";

import { ruleVerdict, tokenizeRegex } from "../regex-rule.ts";

describe("ruleVerdict", () => {
  it("matches like the server: flagless, and again without the provider prefix", () => {
    expect(ruleVerdict({ regex: "^gpt-5", model: "openai/gpt-5.5" })).toBe("match");
    expect(ruleVerdict({ regex: "^gpt-5", model: "GPT-5" })).toBe("no-match");
  });

  it("calls a broken or backtracking pattern invalid", () => {
    expect(ruleVerdict({ regex: "(", model: "x" })).toBe("invalid");
    expect(ruleVerdict({ regex: "(a+)+$", model: "x" })).toBe("invalid");
  });
});

describe("tokenizeRegex", () => {
  it("colours groups, classes, anchors, quantifiers and escapes, losing no text", () => {
    const pattern = "^(?:openai\\/)?gpt-[0-9]\\d{2,3}.*$";
    const tokens = tokenizeRegex(pattern);

    expect(tokens.map((token) => token.text).join("")).toBe(pattern);
    expect(new Set(tokens.map((token) => token.kind))).toEqual(
      new Set(["anchor", "group", "escape", "quantifier", "class", "literal"]),
    );
  });
});
