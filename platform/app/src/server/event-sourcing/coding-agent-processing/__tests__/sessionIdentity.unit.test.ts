import { describe, expect, it } from "vitest";
import { resolveCodingAgentSessionId } from "../sessionIdentity";

describe("given resolveCodingAgentSessionId — the single session-id resolution", () => {
  describe("when a provider session key is present", () => {
    it("resolves to the provider key whether or not a trace id is also present", () => {
      expect(
        resolveCodingAgentSessionId({
          providerSessionKey: "provider-key-1",
          traceId: "trace-1",
        }),
      ).toEqual({ sessionId: "provider-key-1", sessionKeySource: "provider" });
    });
  });

  describe("when no provider session key is present but a trace id is", () => {
    /** @scenario "a session without a session id is not lost" */
    it("falls back to the trace id, identically for every signal that carries one", () => {
      expect(
        resolveCodingAgentSessionId({
          providerSessionKey: null,
          traceId: "trace-1",
        }),
      ).toEqual({ sessionId: "trace-1", sessionKeySource: "trace_fallback" });
    });
  });

  describe("when neither a provider session key nor a trace id is present", () => {
    it("gives up — the one legitimate drop, which the caller counts", () => {
      expect(
        resolveCodingAgentSessionId({
          providerSessionKey: null,
          traceId: null,
        }),
      ).toBeNull();
    });
  });

  describe("when the same inputs reach it from different bridges", () => {
    it("produces the same session id, so one session never folds under two ids", () => {
      const fromSpan = resolveCodingAgentSessionId({
        providerSessionKey: null,
        traceId: "trace-shared",
      });
      const fromLog = resolveCodingAgentSessionId({
        providerSessionKey: null,
        traceId: "trace-shared",
      });

      expect(fromSpan).toEqual(fromLog);
    });
  });
});
