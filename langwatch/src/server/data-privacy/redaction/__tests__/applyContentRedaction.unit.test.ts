import { describe, expect, it } from "vitest";

import {
  compilePolicySecretPatterns,
  needsStrictAnalysis,
  redactStringNative,
} from "../applyContentRedaction";
import type { PiiLevel, ResolvedDataPrivacy } from "../../dataPrivacy.types";
import { EMPTY_AUDIENCE } from "../../dataPrivacy.types";

function policy({
  secretsEnabled = true,
  piiLevel = "essential" as PiiLevel,
  customPatterns = [] as string[],
}): ResolvedDataPrivacy {
  const cat = () => ({ disposition: "capture" as const, audience: { ...EMPTY_AUDIENCE } });
  return {
    categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
    pii: { level: piiLevel },
    secrets: { enabled: secretsEnabled, customPatterns },
    customDropKeys: [],
  };
}

const SECRET = "key sk-ant-" + "A".repeat(40) + " end";
const EMAIL = "mail test@example.com end";

describe("redactStringNative", () => {
  describe("given secrets enabled and essential PII", () => {
    it("redacts both a secret and an email", () => {
      const p = policy({});
      expect(redactStringNative({ text: SECRET, policy: p }).text).toContain("[REDACTED]");
      expect(redactStringNative({ text: EMAIL, policy: p }).text).toBe("mail [REDACTED] end");
    });
  });

  describe("given secrets disabled", () => {
    it("leaves a secret intact", () => {
      const { text } = redactStringNative({ text: SECRET, policy: policy({ secretsEnabled: false }) });
      expect(text).toBe(SECRET);
    });
  });

  describe("given PII disabled but secrets enabled", () => {
    it("redacts the secret but keeps the email", () => {
      const p = policy({ piiLevel: "disabled" });
      expect(redactStringNative({ text: EMAIL, policy: p }).text).toBe(EMAIL);
      expect(redactStringNative({ text: SECRET, policy: p }).text).toContain("[REDACTED]");
    });
  });

  describe("given the strict PII level", () => {
    it("does not run essential natively (strict is batched elsewhere) but still scrubs secrets", () => {
      const p = policy({ piiLevel: "strict" });
      expect(redactStringNative({ text: EMAIL, policy: p }).text).toBe(EMAIL);
      expect(redactStringNative({ text: SECRET, policy: p }).text).toContain("[REDACTED]");
    });
  });

  describe("given a custom secret pattern", () => {
    it("applies it", () => {
      const p = policy({ customPatterns: ["acme_live_[a-z0-9]{8,}"] });
      const compiled = compilePolicySecretPatterns(p);
      const { text } = redactStringNative({
        text: "token acme_live_abcd1234 end",
        policy: p,
        compiledSecretPatterns: compiled,
      });
      expect(text).toBe("token [REDACTED] end");
    });
  });
});

describe("needsStrictAnalysis", () => {
  it("is true only for the strict level", () => {
    expect(needsStrictAnalysis(policy({ piiLevel: "strict" }))).toBe(true);
    expect(needsStrictAnalysis(policy({ piiLevel: "essential" }))).toBe(false);
    expect(needsStrictAnalysis(policy({ piiLevel: "disabled" }))).toBe(false);
  });
});
