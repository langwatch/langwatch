import { describe, expect, it } from "vitest";
import { isModelCallSpan, readString } from "../index";

describe("coding-agent span vocabulary", () => {
  it("recognises model calls without counting nested provider calls", () => {
    expect(isModelCallSpan("claude_code.llm_request")).toBe(true);
    expect(isModelCallSpan("llm_call")).toBe(true);
    expect(isModelCallSpan("chat gpt-5-mini")).toBe(true);
    expect(isModelCallSpan("ai.streamText.doStream")).toBe(false);
  });

  it("reads dotted attributes from flat and unflattened span shapes", () => {
    expect(readString({ "gen_ai.request.model": "flat" }, "gen_ai.request.model")).toBe(
      "flat",
    );
    expect(
      readString({ gen_ai: { request: { model: "nested" } } }, "gen_ai.request.model"),
    ).toBe("nested");
  });
});
