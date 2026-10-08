import { describe, expect, it } from "vitest";

import { instantEvalGuardrailSkipOf } from "../instant-eval-guardrail-skip.rules.ts";

describe("instantEvalGuardrailSkipOf", () => {
  describe("given a guardrail check on the stream chunk direction", () => {
    it("answers skipped with the direction named in the details", () => {
      const result = instantEvalGuardrailSkipOf({ direction: "stream_chunk" });

      expect(result).toEqual({
        status: "skipped",
        details: expect.stringContaining("stream_chunk"),
      });
    });
  });

  describe.each(["request", "response"] as const)("given a %s guardrail check", (direction) => {
    it("answers nothing, so the judge runs", () => {
      expect(instantEvalGuardrailSkipOf({ direction })).toBeNull();
    });
  });

  describe("given a judge that is not a guardrail check", () => {
    it("answers nothing, so the judge runs", () => {
      expect(instantEvalGuardrailSkipOf({ direction: undefined })).toBeNull();
    });
  });
});
