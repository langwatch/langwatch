import { isSensitiveAttributeKey } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";
import type { PiiLevel, ResolvedDataPrivacy } from "../../dataPrivacy.types";
import { EMPTY_AUDIENCE } from "../../dataPrivacy.types";
import {
  compilePolicyPiiExceptions,
  compilePolicySecretPatterns,
  needsStrictAnalysis,
  redactAttributeNative,
  redactStringNative,
  SHAPE_RULE_EXEMPT_ATTRIBUTES,
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

// A real scenario run id: the value the shape rule ate, and the shape every
// reserved identifier attribute carries.
const RUN_ID = "scenariorun_0005FFcHZ7IBvPE1OSWymml0ikKqB";

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

  describe("given a reserved attribute the ingestion pipeline reads", () => {
    // The shape-only rules go on randomness, and a minted id is as random as a
    // minted key. One of them took `scenario.run_id` and the platform lost the
    // link between a trace and its run, so the names the pipeline itself reads
    // leave those two rules out.
    /** @scenario "A reserved identifier attribute keeps its value" */
    it("keeps every reserved identifier exactly as sent", () => {
      const eaten = [...SHAPE_RULE_EXEMPT_ATTRIBUTES]
        .map((key) => ({
          key,
          text: redactAttributeNative({
            key,
            value: RUN_ID,
            policy: policy({}),
          }).text,
        }))
        .filter(({ text }) => text !== RUN_ID);
      expect(eaten).toEqual([]);
    });

    // The other half of the same rule. Turning the whole secrets pass off for
    // these names would trade one hole for a worse one, so only the shape-only
    // rules are skipped and a real credential parked under a reserved name is
    // still replaced by the rule that names its vendor.
    //
    // The tokens are assembled at run time. A complete credential-shaped
    // literal in the source reads as a committed secret to every scanner that
    // walks the repository, the CI gitleaks step included.
    /** @scenario "A credential under a reserved identifier attribute is still redacted" */
    it.each([
      ["a provider key", `sk-ant-${"A".repeat(40)}`],
      ["a GitHub token", `ghp_${"b".repeat(38)}`],
      ["an AWS access key id", `AKIA${"C".repeat(16)}`],
      [
        "a JWT",
        ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJhY21lIn0", "c2lnbmF0dXJl"].join(
          ".",
        ),
      ],
      ["a connection URL password", "postgres://user:hunter2abc@db.internal/x"],
    ])("still redacts %s under every reserved name", (_label, value) => {
      const kept = [...SHAPE_RULE_EXEMPT_ATTRIBUTES].filter(
        (key) =>
          !redactAttributeNative({
            key,
            value,
            policy: policy({}),
          }).text.includes("[SECRET]"),
      );
      expect(kept).toEqual([]);
    });

    /** @scenario "A custom secret pattern still runs on a reserved identifier attribute" */
    it("still applies the customer's own pattern to a reserved name", () => {
      const p = policy({ customPatterns: ["acme_live_[A-Za-z0-9]+"] });
      const { text } = redactAttributeNative({
        key: "scenario.run_id",
        value: "acme_live_9f8e7d6c5b4a39281706",
        policy: p,
        compiledSecretPatterns: compilePolicySecretPatterns(p),
      });
      expect(text).toBe("[SECRET]");
    });

    // The exemption is an exact-name match. A suffixed or nested variant is a
    // name any client can invent, so it keeps the shape-only rules too.
    /** @scenario "A name that only resembles a reserved one is still redacted" */
    it.each([
      "scenario.run_id.extra",
      "custom.scenario.run_id",
      "scenario.run_idx",
    ])("treats %s as ordinary content", (key) => {
      const { text } = redactAttributeNative({
        key,
        value: "sk-ant-" + "A".repeat(40),
        policy: policy({}),
      });
      expect(text).toBe("[SECRET]");
    });

    // The name rule is unchanged by the exemption. No reserved name trips it
    // today, so this asserts the wiring rather than a live case: a reserved
    // name that ever gains a credential word keeps the deny-list.
    /** @scenario "The sensitive name rule still runs on a reserved identifier attribute" */
    it("leaves the sensitive-name deny-list in force", () => {
      const nameRuled = [...SHAPE_RULE_EXEMPT_ATTRIBUTES].filter((key) =>
        isSensitiveAttributeKey(key),
      );
      for (const key of nameRuled) {
        expect(
          redactAttributeNative({
            key,
            value: "ordinary text",
            policy: policy({}),
          }).text,
        ).toBe("[SECRET]");
      }
    });

    /** @scenario "A reserved identifier attribute still runs the personal data pass" */
    it("still replaces an email address under a reserved name", () => {
      const { text } = redactAttributeNative({
        key: "langwatch.user_id",
        value: "test@example.com",
        policy: policy({}),
      });
      expect(text).toBe("[EMAIL_ADDRESS]");
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

describe("redactAttributeNative on identifier-shaped values", () => {
  const stored = (value: string) =>
    redactAttributeNative({ key: "deployment.name", value, policy: policy({}) })
      .text;

  describe("given a value that is exclusively one identifier-shaped token", () => {
    /** @scenario "A datestamped identifier attribute value is not read as a phone number" */
    it("keeps a datestamped identifier whole", () => {
      expect(stored("hosted-eu-20260812-09")).toBe("hosted-eu-20260812-09");
    });

    /** @scenario "A uuid or a digest attribute value is left alone" */
    it("keeps a uuid and a hex digest whole", () => {
      expect(stored("550e8400-e29b-41d4-a716-446655440000")).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(stored("da39a3ee5e6b4b0d3255bfef95601890afd80709")).toBe(
        "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      );
    });

    /** @scenario "A host identifier that embeds an address is left alone" */
    it("keeps a host identifier that embeds an address", () => {
      expect(stored("pod-10.0.0.1")).toBe("pod-10.0.0.1");
    });

    it("still scrubs a credential sent as the whole value", () => {
      expect(stored("sk-ant-" + "A".repeat(40))).toBe("[SECRET]");
    });
  });

  describe("given a value the recognizers can prove", () => {
    /** @scenario "A card number inside an identifier-shaped value is still redacted" */
    it("redacts a checksum-valid card behind an identifier prefix", () => {
      expect(stored("ref-4111111111111111")).toBe("ref-[CREDIT_CARD]");
    });

    /** @scenario "An email address that is the whole attribute value is still redacted" */
    it("redacts an email address that holds digits", () => {
      expect(stored("jane.doe1985@example.com")).toBe("[EMAIL_ADDRESS]");
    });

    it("redacts an email address mentioned inside prose", () => {
      expect(stored("write to jane.doe1985@example.com today")).toBe(
        "write to [EMAIL_ADDRESS] today",
      );
    });
  });

  describe("given a value made of digits and separators only", () => {
    /** @scenario "A phone number that is the whole attribute value is still redacted" */
    it("redacts an international number written with spaces", () => {
      expect(stored("+31 6 12345678")).toBe("[PHONE_NUMBER]");
    });

    /** @scenario "A value of digits and separators with no letters is still redacted" */
    it("redacts a digit run split by a separator", () => {
      expect(stored("20260812-09")).toBe("[PHONE_NUMBER]");
    });
  });

  describe("given a value that is a sentence rather than one token", () => {
    it("redacts a phone number mentioned between words", () => {
      expect(stored("ref 2026081209 checkpoint")).toBe(
        "ref [PHONE_NUMBER] checkpoint",
      );
    });
  });

  describe("given a value that is structure holding data, not an identifier", () => {
    it("redacts a phone number inside minified JSON", () => {
      expect(stored('{"phone":"+14155552671"}')).toBe(
        '{"phone":"[PHONE_NUMBER]"}',
      );
    });

    it("redacts a phone number inside a URL", () => {
      expect(stored("https://acme.example/u/2026081209")).toBe(
        "https://acme.example/u/[PHONE_NUMBER]",
      );
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
