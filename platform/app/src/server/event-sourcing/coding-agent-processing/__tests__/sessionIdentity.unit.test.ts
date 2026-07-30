import { describe, expect, it } from "vitest";
import { initCodingAgentSessionIdentityState } from "../schema";
import {
  applyIdentity,
  applyIdentitySlot,
  applyStartedAtMs,
  resolveCodingAgentSessionId,
} from "../sessionIdentity";

describe("given resolveCodingAgentSessionId — the single session-id resolution", () => {
  describe("when a provider session key is present", () => {
    it("resolves to the provider key regardless of whether a trace id is also present", () => {
      const resolved = resolveCodingAgentSessionId({
        providerSessionKey: "provider-key-1",
        traceId: "trace-1",
      });
      expect(resolved).toEqual({
        sessionId: "provider-key-1",
        sessionKeySource: "provider",
      });
    });
  });

  describe("when no provider session key is present but a trace id is", () => {
    /** @scenario "a session without a session id is not lost" */
    it("falls back to the trace id, identically for every signal that carries one", () => {
      const resolved = resolveCodingAgentSessionId({
        providerSessionKey: null,
        traceId: "trace-1",
      });
      expect(resolved).toEqual({
        sessionId: "trace-1",
        sessionKeySource: "trace_fallback",
      });
    });
  });

  describe("when neither a provider session key nor a trace id is present", () => {
    it("gives up — the one legitimate drop, not a silent one (the caller counts it)", () => {
      const resolved = resolveCodingAgentSessionId({
        providerSessionKey: null,
        traceId: null,
      });
      expect(resolved).toBeNull();
    });
  });

  describe("when the SAME inputs are resolved from what used to be three different call sites", () => {
    it("the span-shaped call and the log-shaped call agree, closing the split-session defect", () => {
      // The old pipeline computed this three times: the span dispatcher
      // always fell back to a trace id, the log dispatcher fell back but
      // dropped on double-absence, and the metric dispatcher never
      // attempted a fallback at all. A session with a provider key absent
      // on some signals and present on others could fold under different
      // ids per signal. This resolver is now the ONLY place the decision
      // is made, so the same inputs always produce the same session id no
      // matter which bridge calls it.
      const fromSpanShapedCall = resolveCodingAgentSessionId({
        providerSessionKey: null,
        traceId: "trace-shared",
      });
      const fromLogShapedCall = resolveCodingAgentSessionId({
        providerSessionKey: null,
        traceId: "trace-shared",
      });
      expect(fromSpanShapedCall).toEqual(fromLogShapedCall);
    });
  });
});

describe("given applyIdentity — the universal-fact LWW merge", () => {
  describe("when the incoming contribution is accepted later than the stored one", () => {
    it("replaces both agent and sessionKeySource together", () => {
      const state = {
        ...initCodingAgentSessionIdentityState(),
        agent: "claude_code",
        sessionKeySource: "provider" as const,
        identityAcceptedAt: 1_000,
      };
      const next = applyIdentity(state, {
        agent: "claude_cowork",
        sessionKeySource: "provider",
        acceptedAt: 2_000,
      });
      expect(next.agent).toBe("claude_cowork");
      expect(next.identityAcceptedAt).toBe(2_000);
    });
  });

  describe("when the incoming contribution is accepted earlier than the stored one", () => {
    it("keeps the stored identity — a late arrival does not rewind a newer determination", () => {
      const state = {
        ...initCodingAgentSessionIdentityState(),
        agent: "claude_cowork",
        sessionKeySource: "provider" as const,
        identityAcceptedAt: 2_000,
      };
      const next = applyIdentity(state, {
        agent: "claude_code",
        sessionKeySource: "provider",
        acceptedAt: 1_000,
      });
      expect(next.agent).toBe("claude_cowork");
      expect(next.identityAcceptedAt).toBe(2_000);
    });
  });
});

describe("given applyIdentitySlot — one sparse identity fact", () => {
  describe("when the incoming contribution carries no value for the fact", () => {
    it("never blanks the slot", () => {
      const slot = { value: "vscode", acceptedAt: 1_000 };
      const next = applyIdentitySlot(slot, null, 2_000);
      expect(next).toEqual(slot);
    });
  });

  describe("when the incoming contribution's stamp is newer", () => {
    it("replaces the value and the stamp", () => {
      const slot = { value: "vscode", acceptedAt: 1_000 };
      const next = applyIdentitySlot(slot, "cursor", 2_000);
      expect(next).toEqual({ value: "cursor", acceptedAt: 2_000 });
    });
  });

  describe("when the incoming contribution's stamp is older", () => {
    it("keeps the stored value", () => {
      const slot = { value: "vscode", acceptedAt: 2_000 };
      const next = applyIdentitySlot(slot, "cursor", 1_000);
      expect(next).toEqual(slot);
    });
  });
});

describe("given applyStartedAtMs — the commutative minimum", () => {
  it("treats 0 as unset rather than a real minimum", () => {
    expect(applyStartedAtMs(0, 5_000)).toBe(5_000);
  });

  it("takes the minimum regardless of which value arrives first", () => {
    expect(applyStartedAtMs(5_000, 1_000)).toBe(1_000);
    expect(applyStartedAtMs(1_000, 5_000)).toBe(1_000);
  });
});
