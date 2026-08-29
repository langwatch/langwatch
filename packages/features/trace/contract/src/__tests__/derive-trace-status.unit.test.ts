import { describe, expect, it } from "vitest";
import { deriveTraceStatus } from "../derive-trace-status";

describe("deriveTraceStatus", () => {
  describe("given a span flipped containsErrorStatus", () => {
    /** @scenario Trace status is error when any span reports OTel ERROR */
    it("returns 'error', and stays 'error' even when also blockedByGuardrail", () => {
      expect(
        deriveTraceStatus({
          containsErrorStatus: true,
          blockedByGuardrail: false,
        }),
      ).toBe("error");
      expect(
        deriveTraceStatus({
          containsErrorStatus: true,
          blockedByGuardrail: true,
        }),
      ).toBe("error");
    });
  });

  describe("given a guardrail-blocked trace with no errors", () => {
    /** @scenario Trace status is warning when the trace ran but was guardrail-blocked */
    it("returns 'warning'", () => {
      expect(
        deriveTraceStatus({
          containsErrorStatus: false,
          blockedByGuardrail: true,
        }),
      ).toBe("warning");
    });
  });

  describe("given no errors and no guardrail blocks", () => {
    /** @scenario Trace status defaults to ok when OTel StatusCode is UNSET on every span */
    it("returns 'ok' when no OK was reported either (UNSET on every span)", () => {
      // Pre-fix this case returned "warning", which was firing on 118k
      // of every 327k traces in a 2026-05-20 7-day prod sweep — every
      // happy trace from any SDK that doesn't explicitly bump
      // StatusCode to OK (effectively all of them). UNSET is the
      // OTel-correct default for "no opinion"; treat it as ok.
      expect(
        deriveTraceStatus({
          containsErrorStatus: false,
          blockedByGuardrail: false,
        }),
      ).toBe("ok");
    });
  });
});
