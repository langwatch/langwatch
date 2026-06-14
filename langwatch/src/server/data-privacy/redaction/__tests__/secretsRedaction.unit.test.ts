import { describe, expect, it } from "vitest";

import {
  BUILTIN_SECRET_RULES,
  compileSecretPatterns,
  detectSecretsInText,
  isSensitiveAttributeKey,
  redactSecretsInText,
} from "../secretsRedaction";

const redact = (text: string, customPatterns?: readonly RegExp[]) =>
  redactSecretsInText({ text, customPatterns });

describe("redactSecretsInText", () => {
  describe("given a built-in provider or cloud key", () => {
    const cases: Array<[string, string]> = [
      ["an AWS access key id", "creds AKIAIOSFODNN7EXAMPLE here"],
      ["a GitHub token", `token ghp_${"a".repeat(36)} here`],
      ["an OpenAI key", `key sk-proj-${"A".repeat(40)} here`],
      ["an Anthropic key", `key sk-ant-api03-${"A".repeat(40)} here`],
      ["a Slack token", `xoxb-${"1".repeat(20)} here`],
      ["a Google API key", `AIza${"A".repeat(35)} here`],
      ["a Stripe secret key", `sk_live_${"a".repeat(24)} here`],
      [
        "a JWT",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456",
      ],
    ];

    for (const [label, input] of cases) {
      it(`redacts ${label}`, () => {
        const { text, redactedCount } = redact(input);
        expect(text).toContain("[SECRET]");
        expect(redactedCount).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("given a PEM private key block", () => {
    it("redacts the whole block", () => {
      const input =
        "key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\nDEFghi\n-----END RSA PRIVATE KEY-----\ntail";
      const { text } = redact(input);
      expect(text).not.toContain("MIIabc");
      expect(text).toContain("[SECRET]");
      expect(text).toContain("tail");
    });
  });

  describe("given a database URL with a password", () => {
    it("redacts only the password and keeps scheme, user, host, and database", () => {
      const { text } = redact("postgres://app:hunter2@db.internal:5432/app");
      expect(text).toBe("postgres://app:[SECRET]@db.internal:5432/app");
    });
  });

  describe("given a bearer authorization header value", () => {
    it("redacts the token and keeps the Bearer prefix", () => {
      const { text } = redact("Authorization: Bearer abc123token456xyz");
      expect(text).toBe("Authorization: Bearer [SECRET]");
    });
  });

  describe("given ordinary text with no secrets", () => {
    it("leaves it unchanged", () => {
      const input = "The model answered in 42 ms and the user said thanks.";
      const { text, redactedCount } = redact(input);
      expect(text).toBe(input);
      expect(redactedCount).toBe(0);
    });

    it("does not match a short 'sk' substring inside an ordinary word", () => {
      const input = "please ask the desk about the task";
      expect(redact(input).text).toBe(input);
    });
  });

  describe("given an input larger than the scan budget", () => {
    it("returns it untouched", () => {
      const input = "AKIAIOSFODNN7EXAMPLE " + "x".repeat(250_001);
      const { text, redactedCount } = redact(input);
      expect(text).toBe(input);
      expect(redactedCount).toBe(0);
    });
  });

  describe("given a custom pattern", () => {
    it("redacts a company-specific token shape", () => {
      const custom = compileSecretPatterns(["acme_live_[a-z0-9]{8,}"]);
      const { text, redactedCount } = redact(
        "token acme_live_abcd1234 end",
        custom,
      );
      expect(text).toBe("token [SECRET] end");
      expect(redactedCount).toBe(1);
    });
  });
});

describe("compileSecretPatterns", () => {
  describe("given an uncompilable pattern", () => {
    it("skips it without throwing", () => {
      const compiled = compileSecretPatterns(["valid[0-9]+", "("]);
      expect(compiled).toHaveLength(1);
    });
  });
});

describe("isSensitiveAttributeKey", () => {
  describe("given a sensitive attribute name", () => {
    for (const key of [
      "Authorization",
      "x-api-key",
      "DB_PASSWORD",
      "client_secret",
      "set-cookie",
    ]) {
      it(`flags ${key}`, () => {
        expect(isSensitiveAttributeKey(key)).toBe(true);
      });
    }
  });

  describe("given an ordinary metadata key", () => {
    for (const key of [
      "model",
      "latency",
      "gen_ai.usage.input_tokens",
      "span.name",
    ]) {
      it(`does not flag ${key}`, () => {
        expect(isSensitiveAttributeKey(key)).toBe(false);
      });
    }
  });
});

describe("BUILTIN_SECRET_RULES", () => {
  it("exposes one entry per built-in value rule for the UI", () => {
    expect(BUILTIN_SECRET_RULES.length).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_SECRET_RULES.every((r) => r.id && r.description)).toBe(true);
  });
});

describe("detectSecretsInText", () => {
  describe("given text with a provider key", () => {
    it("reports the rule that matched and where, without altering the text", () => {
      const input = `key sk-proj-${"A".repeat(40)} here`;
      const matches = detectSecretsInText({ text: input });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.ruleId).toBe("openai_api_key");
      // The detector never mutates the input.
      expect(input).toContain("sk-proj-");
    });
  });

  describe("given text with several distinct secrets", () => {
    it("reports each one", () => {
      const matches = detectSecretsInText({
        text: `aws AKIAIOSFODNN7EXAMPLE and gh ghp_${"a".repeat(36)}`,
      });
      const ruleIds = matches.map((m) => m.ruleId).sort();
      expect(ruleIds).toEqual(["aws_access_key_id", "github_token"]);
    });
  });

  describe("given a custom pattern", () => {
    it("reports it as a custom_pattern match", () => {
      const custom = compileSecretPatterns(["acme_live_[a-z0-9]{8,}"]);
      const matches = detectSecretsInText({
        text: "token acme_live_abcd1234 end",
        customPatterns: custom,
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.ruleId).toBe("custom_pattern");
    });
  });

  describe("given ordinary text", () => {
    it("returns no matches", () => {
      expect(detectSecretsInText({ text: "the user said thanks" })).toEqual([]);
    });
  });

  describe("given already-redacted text carrying a [SECRET] marker", () => {
    it("does not re-detect the marker as a secret", () => {
      expect(
        detectSecretsInText({ text: "authorization: [SECRET]" }),
      ).toEqual([]);
    });
  });
});
