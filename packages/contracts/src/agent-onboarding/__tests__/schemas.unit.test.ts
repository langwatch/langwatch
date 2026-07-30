import { describe, expect, it } from "vitest";
import {
  claimExchangeResponseSchema,
  claimHandoffStartRequestSchema,
  codeVerifierSchema,
  fingerprintSchema,
  provisionRequestSchema,
} from "../index.js";

describe("the provision request", () => {
  describe("when the agent is one we know", () => {
    it("parses", () => {
      expect(provisionRequestSchema.parse({ agent: "claude_code" }).agent).toBe(
        "claude_code",
      );
    });
  });

  describe("when the agent is not one we know", () => {
    it("is rejected rather than stored as provenance we cannot read", () => {
      expect(
        provisionRequestSchema.safeParse({ agent: "totally_made_up" }).success,
      ).toBe(false);
    });
  });

  describe("when no fingerprint is sent", () => {
    it("parses — the axis simply does not apply", () => {
      expect(provisionRequestSchema.safeParse({ agent: "codex" }).success).toBe(
        true,
      );
    });
  });

  describe("when the fingerprint is outside its bounds", () => {
    it.each([
      { label: "too short to identify anything", value: "abc" },
      { label: "long enough to be a payload", value: "x".repeat(513) },
    ])("rejects one $label", ({ value }) => {
      expect(fingerprintSchema.safeParse(value).success).toBe(false);
    });
  });
});

describe("the PKCE handoff request", () => {
  const valid = {
    claimToken: "token",
    codeChallenge: "c".repeat(43),
    codeChallengeMethod: "S256" as const,
  };

  describe("when the method is S256", () => {
    it("parses", () => {
      expect(claimHandoffStartRequestSchema.safeParse(valid).success).toBe(
        true,
      );
    });
  });

  describe("when the method is plain", () => {
    it("is refused — plain puts the verifier in the request", () => {
      expect(
        claimHandoffStartRequestSchema.safeParse({
          ...valid,
          codeChallengeMethod: "plain",
        }).success,
      ).toBe(false);
    });
  });

  describe("when the challenge is not unpadded base64url", () => {
    it.each([
      { label: "padding", value: `${"c".repeat(42)}=` },
      { label: "a slash", value: `${"c".repeat(42)}/` },
      { label: "a plus", value: `${"c".repeat(42)}+` },
    ])("rejects a challenge containing $label", ({ value }) => {
      expect(
        claimHandoffStartRequestSchema.safeParse({
          ...valid,
          codeChallenge: value,
        }).success,
      ).toBe(false);
    });
  });

  describe("when the verifier is outside RFC 7636's length bounds", () => {
    it.each([42, 129])("rejects a verifier of length %i", (length) => {
      expect(codeVerifierSchema.safeParse("v".repeat(length)).success).toBe(
        false,
      );
    });

    it.each([43, 128])("accepts a verifier of length %i", (length) => {
      expect(codeVerifierSchema.safeParse("v".repeat(length)).success).toBe(
        true,
      );
    });
  });
});

describe("the exchange response", () => {
  describe("when it is still pending", () => {
    it("carries the interval and no result", () => {
      const parsed = claimExchangeResponseSchema.parse({
        status: "pending",
        pollIntervalSeconds: 5,
      });
      expect(parsed).toEqual({ status: "pending", pollIntervalSeconds: 5 });
    });
  });

  describe("when a branch carries the other branch's fields", () => {
    it("is refused, so a client can trust the discriminant", () => {
      expect(
        claimExchangeResponseSchema.safeParse({
          status: "approved",
          pollIntervalSeconds: 5,
        }).success,
      ).toBe(false);
    });
  });
});
