import { describe, expect, it } from "vitest";
import type { PiiLevel, ResolvedDataPrivacy } from "../../dataPrivacy.types";
import { EMPTY_AUDIENCE } from "../../dataPrivacy.types";
import {
  compilePolicyPiiExceptions,
  compilePolicySecretPatterns,
  needsStrictAnalysis,
  redactAttributeNative,
  redactStringNative,
} from "../applyContentRedaction";

function policy({
  secretsEnabled = true,
  piiLevel = "essential" as PiiLevel,
  customPatterns = [] as string[],
  exceptPatterns = [] as string[],
}): ResolvedDataPrivacy {
  const cat = () => ({
    disposition: "capture" as const,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
    pii: { level: piiLevel, entities: [], exceptPatterns },
    secrets: { enabled: secretsEnabled, customPatterns },
    customAttributes: [],
  };
}

const SECRET = "key sk-ant-" + "A".repeat(40) + " end";
const EMAIL = "mail test@example.com end";

describe("redactStringNative", () => {
  describe("given secrets enabled and essential PII", () => {
    it("redacts both a secret and an email", () => {
      const p = policy({});
      expect(redactStringNative({ text: SECRET, policy: p }).text).toContain(
        "[SECRET]",
      );
      expect(redactStringNative({ text: EMAIL, policy: p }).text).toBe(
        "mail [EMAIL_ADDRESS] end",
      );
    });
  });

  describe("given secrets disabled", () => {
    it("leaves a secret intact", () => {
      const { text } = redactStringNative({
        text: SECRET,
        policy: policy({ secretsEnabled: false }),
      });
      expect(text).toBe(SECRET);
    });
  });

  describe("given PII disabled but secrets enabled", () => {
    it("redacts the secret but keeps the email", () => {
      const p = policy({ piiLevel: "disabled" });
      expect(redactStringNative({ text: EMAIL, policy: p }).text).toBe(EMAIL);
      expect(redactStringNative({ text: SECRET, policy: p }).text).toContain(
        "[SECRET]",
      );
    });
  });

  describe("given the strict PII level", () => {
    it("runs essential PII natively as a floor and still scrubs secrets (strict names/locations are batched elsewhere)", () => {
      const p = policy({ piiLevel: "strict" });
      expect(redactStringNative({ text: EMAIL, policy: p }).text).toBe(
        "mail [EMAIL_ADDRESS] end",
      );
      expect(redactStringNative({ text: SECRET, policy: p }).text).toContain(
        "[SECRET]",
      );
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
      expect(text).toBe("token [SECRET] end");
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

describe("redactAttributeNative", () => {
  describe("given the receiver-written api key id attribute", () => {
    it("keeps an opaque key id readable", () => {
      const { text } = redactAttributeNative({
        key: "langwatch.api_key.id",
        value: "key_abc123def456",
        policy: policy({}),
      });
      expect(text).toBe("key_abc123def456");
    });

    it("still scrubs actual key material under that name via the value rules", () => {
      const { text } = redactAttributeNative({
        key: "langwatch.api_key.id",
        value: "sk-lw-" + "a".repeat(40),
        policy: policy({}),
      });
      expect(text).toContain("[SECRET]");
      expect(text).not.toContain("sk-lw-");
    });
  });

  describe("given a name that only resembles the exempt one", () => {
    // The exemption is an exact-name match, and it has to stay that way: it is
    // sound only for the one attribute the receiver rewrites on every request,
    // so a suffixed or nested variant carries no such guarantee.
    it.each([
      "langwatch.api_key.id.extra",
      "langwatch.api_key.identifier",
      "custom.langwatch.api_key.id",
    ])("nukes %s by name", (key) => {
      const { text } = redactAttributeNative({
        key,
        value: "not even a secret shape",
        policy: policy({}),
      });
      expect(text).toBe("[SECRET]");
    });
  });

  describe("given any other api_key-named attribute", () => {
    it("nukes the whole value by name, regardless of shape", () => {
      const { text } = redactAttributeNative({
        key: "user.api_key",
        value: "not even a secret shape",
        policy: policy({}),
      });
      expect(text).toBe("[SECRET]");
    });
  });

  describe("given PII exceptions on the policy", () => {
    it("threads them into the value pass", () => {
      const p = policy({ exceptPatterns: ["00\\d{12}"] });
      const { text } = redactAttributeNative({
        key: "gen_ai.prompt",
        value: "reservation 00528000043000 for test@example.com",
        policy: p,
        compiledPiiExceptions: compilePolicyPiiExceptions(p),
      });
      expect(text).toBe("reservation 00528000043000 for [EMAIL_ADDRESS]");
    });
  });
});

describe("redactStringNative with policy PII exceptions", () => {
  it("keeps a fully matched value and redacts everything else", () => {
    const p = policy({ exceptPatterns: ["00\\d{12}"] });
    const { text } = redactStringNative({
      text: "res 00528000043000 card 4111111111111111",
      policy: p,
      compiledPiiExceptions: compilePolicyPiiExceptions(p),
    });
    expect(text).toBe("res 00528000043000 card [CREDIT_CARD]");
  });
});
