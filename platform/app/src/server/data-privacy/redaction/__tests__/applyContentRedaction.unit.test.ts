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

// A real scenario run id: the value the shape rule ate at ingestion.
const RUN_ID = "scenariorun_0005FFcHZ7IBvPE1OSWymml0ikKqB";

// A token with a prefix no vendor list names, a body of 39 characters mixing
// both cases with digits, and no credential word anywhere near it. Only
// `shaped_api_key` can match it, so it is what tells the shape rules apart
// from the rest of the pass.
const SHAPED_TOKEN = "unlisted_aB3dEf7gHi2jKlMnOpQrStUvWx0123456789xYz";

// The attribute names the ingestion pipeline reads to attach a span to its
// run, its prompt, its conversation, its user and its customer, plus the
// gateway and ingestion provenance. Every one of them ends in `_id` or `.id`,
// which is what `isIdentifierAttributeName` reads.
const IDENTIFIER_NAMES = [
  "scenario.run_id",
  "evaluation.run_id",
  "langwatch.prompt.id",
  "langwatch.prompt.selected.id",
  "langwatch.prompt.version.id",
  "gen_ai.conversation.id",
  "langwatch.thread.id",
  "langwatch.thread_id",
  "langwatch.langgraph.thread_id",
  "metadata.thread_id",
  "langwatch.user.id",
  "langwatch.user_id",
  "metadata.user_id",
  "langwatch.customer.id",
  "langwatch.customer_id",
  "metadata.customer_id",
  "langwatch.virtual_key_id",
  "langwatch.gateway_request_id",
  "langwatch.model_provider_id",
  "langwatch.ingestion_source.id",
  "langwatch.ingestion_source.organization_id",
  "id",
];

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

  describe("given a name that only resembles an identifier one", () => {
    // The rule reads the END of the name. `identifier` and a segment after
    // `.id` both say something other than "this holds an id", so the
    // deny-list keeps its hold on them.
    it.each([
      "langwatch.api_key.id.extra",
      "langwatch.api_key.identifier",
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

  describe("given Better Auth observability attributes", () => {
    describe("when an exact non-credential name holds an ordinary value", () => {
      /** @scenario "Better Auth observability attributes keep non-sensitive values" */
      it.each([
        ["better_auth.hook.type", "create.before"],
        ["better_auth.context", "plugin:bearer"],
      ])("keeps %s holding %s", (key, value) => {
        expect(
          redactAttributeNative({ key, value, policy: policy({}) }).text,
        ).toBe(value);
      });
    });

    describe("when a sibling name says it holds a credential", () => {
      /** @scenario "A credential attribute beside Better Auth observability attributes is still redacted" */
      it("replaces an ordinary value by name", () => {
        expect(
          redactAttributeNative({
            key: "better_auth.token",
            value: "ordinary text",
            policy: policy({}),
          }).text,
        ).toBe("[SECRET]");
      });
    });

    describe("when an exempt name holds a secret", () => {
      /** @scenario "A secret under a Better Auth observability attribute is still redacted" */
      it("keeps the shape-only secret rules active", () => {
        expect(
          redactAttributeNative({
            key: "better_auth.context",
            value: SHAPED_TOKEN,
            policy: policy({}),
          }).text,
        ).toBe("[SECRET]");
      });

      /** @scenario "A secret under a Better Auth observability attribute is still redacted" */
      it("keeps vendor-specific secret rules active", () => {
        const { text } = redactAttributeNative({
          key: "better_auth.hook.type",
          value: `sk-ant-${"A".repeat(40)}`,
          policy: policy({}),
        });
        expect(text).toBe("[SECRET]");
      });

      /** @scenario "A secret under a Better Auth observability attribute is still redacted" */
      it("keeps customer secret patterns active", () => {
        const p = policy({ customPatterns: ["acme_live_[A-Za-z0-9]+"] });
        expect(
          redactAttributeNative({
            key: "better_auth.context",
            value: "acme_live_9f8e7d6c5b4a39281706",
            policy: p,
            compiledSecretPatterns: compilePolicySecretPatterns(p),
          }).text,
        ).toBe("[SECRET]");
      });
    });

    describe("when an exempt name holds personal data", () => {
      /** @scenario "Personal data under a Better Auth observability attribute is still redacted" */
      it("keeps the personal-data pass active", () => {
        expect(
          redactAttributeNative({
            key: "better_auth.context",
            value: "test@example.com",
            policy: policy({}),
          }).text,
        ).toBe("[EMAIL_ADDRESS]");
      });
    });
  });

  describe("given an attribute whose name says it is an identifier", () => {
    describe("when the value is an id the product minted", () => {
      /** @scenario "An identifier attribute keeps the id it holds" */
      it("keeps the id under every name the pipeline reads", () => {
        const eaten = IDENTIFIER_NAMES.map((key) => ({
          key,
          text: redactAttributeNative({
            key,
            value: RUN_ID,
            policy: policy({}),
          }).text,
        })).filter(({ text }) => text !== RUN_ID);
        expect(eaten).toEqual([]);
      });
    });

    describe("when the value is a token only the shape rules can match", () => {
      // The token carries no vendor namespace and no credential word, so
      // `shaped_api_key` is the only rule that can take it. That is what makes
      // this pair the proof: the same value survives under an identifier name
      // and is replaced under a name that is not one.
      /** @scenario "An identifier attribute keeps the id it holds" */
      it("keeps it under every identifier name", () => {
        const eaten = IDENTIFIER_NAMES.map((key) => ({
          key,
          text: redactAttributeNative({
            key,
            value: SHAPED_TOKEN,
            policy: policy({}),
          }).text,
        })).filter(({ text }) => text !== SHAPED_TOKEN);
        expect(eaten).toEqual([]);
      });

      /** @scenario "The shape rules still run on an attribute that is not an identifier" */
      it.each([
        "langwatch.input",
        "langwatch.output",
        "gen_ai.prompt",
        "scenario.run_name",
      ])("replaces it under %s", (key) => {
        expect(
          redactAttributeNative({
            key,
            value: SHAPED_TOKEN,
            policy: policy({}),
          }).text,
        ).toBe("[SECRET]");
      });

      // `langwatch.input` and `langwatch.output` are the reason the rule reads
      // the name and never a namespace: they carry the chat content itself, so
      // a `langwatch.*` rule would take the shape rules off the largest
      // customer text in the product.
      /** @scenario "The shape rules still run on an attribute that is not an identifier" */
      it.each([
        "langwatch.input",
        "langwatch.output",
      ])("replaces a vendor key sent inside %s", (key) => {
        const { text } = redactAttributeNative({
          key,
          value: `here is the key sk-ant-${"A".repeat(40)} use it`,
          policy: policy({}),
        });
        expect(text).toContain("[SECRET]");
        expect(text).not.toContain("sk-ant-");
      });
    });

    describe("when the value is a credential a vendor minted", () => {
      // Turning the whole secrets pass off for an identifier name would trade
      // one hole for a worse one, so only the shape rules are skipped. These
      // values are taken by the rules that read a vendor namespace, armour or
      // a URL password, and those rules still run.
      //
      // The tokens are assembled at run time. A complete credential-shaped
      // literal in the source reads as a committed secret to every scanner
      // that walks the repository, the CI gitleaks step included.
      /** @scenario "A credential under an identifier attribute is still redacted" */
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
        [
          "a connection URL password",
          "postgres://user:hunter2abc@db.internal/x",
        ],
      ])("still redacts %s under every identifier name", (_label, value) => {
        const kept = IDENTIFIER_NAMES.filter(
          (key) =>
            !redactAttributeNative({
              key,
              value,
              policy: policy({}),
            }).text.includes("[SECRET]"),
        );
        expect(kept).toEqual([]);
      });
    });

    describe("when the customer added a pattern of their own", () => {
      /** @scenario "A custom secret pattern still runs on an identifier attribute" */
      it("still applies that pattern under an identifier name", () => {
        const p = policy({ customPatterns: ["acme_live_[A-Za-z0-9]+"] });
        const { text } = redactAttributeNative({
          key: "scenario.run_id",
          value: "acme_live_9f8e7d6c5b4a39281706",
          policy: p,
          compiledSecretPatterns: compilePolicySecretPatterns(p),
        });
        expect(text).toBe("[SECRET]");
      });
    });

    describe("when the name is the identifier OF a credential", () => {
      // `api_key.id` names a row id, not key material. The deny-list matches
      // the word `api_key` in the name, so without the identifier rule the id
      // is replaced and the field that says which key produced a trace is
      // gone. The credential itself keeps the deny-list.
      /** @scenario "The identifier of a credential keeps its value while the credential does not" */
      it.each([
        "langwatch.api_key.id",
        "gateway.token_id",
        "vault.password_id",
      ])("keeps the row id under %s", (key) => {
        expect(
          redactAttributeNative({
            key,
            value: "apikey_2bTxYq4NfPzR7WcJ1mHdKsVgL",
            policy: policy({}),
          }).text,
        ).toBe("apikey_2bTxYq4NfPzR7WcJ1mHdKsVgL");
      });

      /** @scenario "The identifier of a credential keeps its value while the credential does not" */
      it.each([
        "api_key",
        "authorization",
        "langwatch.api_key",
      ])("still replaces the whole value under %s", (key) => {
        expect(
          redactAttributeNative({
            key,
            value: "ordinary text",
            policy: policy({}),
          }).text,
        ).toBe("[SECRET]");
      });
    });

    describe("when the name only resembles an identifier name", () => {
      // The rule reads the END of the name. A name that puts a character after
      // `_id` says something else, so it keeps every rule.
      /** @scenario "A name that only resembles an identifier name keeps the shape rules" */
      it.each([
        "scenario.run_idx",
        "scenario.run_id.extra",
        "scenario.ident",
      ])("treats %s as ordinary content", (key) => {
        expect(
          redactAttributeNative({
            key,
            value: SHAPED_TOKEN,
            policy: policy({}),
          }).text,
        ).toBe("[SECRET]");
      });
    });

    describe("when the value is personal data", () => {
      /** @scenario "An identifier attribute still runs the personal data pass" */
      it("still replaces an email address under an identifier name", () => {
        const { text } = redactAttributeNative({
          key: "langwatch.user_id",
          value: "test@example.com",
          policy: policy({}),
        });
        expect(text).toBe("[EMAIL_ADDRESS]");
      });
    });
  });

  describe("given a prompt attribute the identifier rule does not cover", () => {
    // A handle and a version number are not identifier names, and they do not
    // need to be. `handleSchema` accepts lowercase letters, digits, hyphens,
    // underscores and one slash, and the shape rule needs two uppercase
    // characters before it fires, so no handle the product accepts can reach
    // it. The legacy `prompt_<nanoid>` handle carries a 21-character body,
    // under the rule's 26-character floor. A version number is digits.
    /** @scenario "A prompt handle and a version number survive redaction" */
    it.each([
      ["langwatch.prompt.handle", "customer-support-triage-assistant-v2"],
      [
        "langwatch.prompt.handle",
        "acme-platform/customer-support-triage-assistant",
      ],
      [
        "langwatch.prompt.handle",
        "release_2026_08_25_experimental_router_prompt",
      ],
      ["langwatch.prompt.handle", "prompt_V1StGXR8Z5jdHi6BmyT"],
      ["langwatch.prompt.version.number", "128"],
    ])("keeps %s holding %s", (key, value) => {
      expect(
        redactAttributeNative({ key, value, policy: policy({}) }).text,
      ).toBe(value);
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
