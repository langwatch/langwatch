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
  describe("given the receiver-stamped ingestion key id attribute", () => {
    it("keeps an opaque key id readable under its reserved name", () => {
      const { text } = redactAttributeNative({
        key: "langwatch.ingest_key_id",
        value: "key_abc123def456",
        policy: policy({}),
      });
      expect(text).toBe("key_abc123def456");
    });

    it("still scrubs actual key material under that name via the value rules", () => {
      const { text } = redactAttributeNative({
        key: "langwatch.ingest_key_id",
        value: "sk-lw-" + "a".repeat(40),
        policy: policy({}),
      });
      expect(text).toContain("[SECRET]");
      expect(text).not.toContain("sk-lw-");
    });
  });

  describe("given a non-ingestion attribute claiming the old langwatch.api_key.id name", () => {
    it("nukes an arbitrary value by name, since only the receiver-stamped reserved name is exempt", () => {
      // A regular project API key (no ingestSourceType) never goes through
      // the receiver's provenance stamp, so a client can put anything under
      // this literal name. It must still be covered by the deny-list, not
      // waved through by shape-based value scanning alone.
      const { text } = redactAttributeNative({
        key: "langwatch.api_key.id",
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
