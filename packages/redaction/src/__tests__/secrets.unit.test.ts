import { describe, expect, it } from "vitest";

import {
  BUILTIN_SECRET_RULES,
  compileSecretPatterns,
  detectSecretsInText,
  isSensitiveAttributeKey,
  overBroadSecretPatternProbe,
  redactSecretsInText,
  SHAPE_ONLY_SECRET_RULE_IDS,
} from "../secrets.js";

const redact = (text: string, customPatterns?: readonly RegExp[]) =>
  redactSecretsInText({ text, customPatterns });

/**
 * Fixture bodies, assembled into tokens at runtime so no complete
 * credential-shaped literal ever exists in this file. The shapes have to stay
 * realistic to be worth testing, and a literal one trips every secret scanner
 * that reads the repository, GitHub push protection included.
 */
const BODY = "aB3dEf7gHi2jKlMnOpQrStUvWx0123456789xYzAbCdEfGh";
const HEX = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
/**
 * Mirrors MAX_SCAN_LENGTH in the module under test, which is not exported.
 * Derived rather than written inline at each use so a change to the budget
 * moves every boundary case with it, instead of leaving them passing while
 * testing nothing near the boundary.
 */
const SCAN_BUDGET = 250_000;

/**
 * PEM armour, assembled at run time. Spelling it out as a literal makes the
 * secret scanners treat this fixture as a real committed private key and blocks
 * the push, the same reason the vendor tokens above are built from parts.
 */
const pemArmour = (edge: "BEGIN" | "END", label: string) =>
  `${"-".repeat(5)}${edge} ${label}${"-".repeat(5)}`;
const pemBlock = (label: string, body: string) =>
  `${pemArmour("BEGIN", label)}\n${body}\n${pemArmour("END", label)}`;

describe("redactSecretsInText", () => {
  describe("given a built-in provider or cloud key", () => {
    // Provider keys use realistic base64url bodies (`_` and `-`, no inner word
    // boundary): the shape a `[A-Za-z0-9]+\b` rule silently misses.
    const cases: Array<[string, string]> = [
      ["an AWS access key id", "creds AKIAIOSFODNN7EXAMPLE here"],
      ["a GitHub token", `token ghp_${"a".repeat(36)} here`],
      ["an OpenAI project key", "key sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xY here"],
      ["an Anthropic key", "key sk-ant-api03-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789 here"],
      ["a LangWatch key", "key sk-lw-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789 here"],
      ["a Slack token", `xoxb-${"1".repeat(20)} here`],
      ["a Google API key", `AIza${"A".repeat(35)} here`],
      ["a Stripe secret key", `sk_live_${"a".repeat(24)} here`],
      ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456"],
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
      const input = `key:\n${pemBlock("RSA PRIVATE KEY", "MIIabc\nDEFghi")}\ntail`;
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

    /** @scenario "A connection URL keeps its scheme whatever shape the scheme has" */
    it("keeps every shape of scheme and redacts only the password", () => {
      const cases: Array<[string, string]> = [
        ["redis://default:Ab3xY9zQ@cache-01:6379", "redis://default:[SECRET]@cache-01:6379"],
        [
          "mongodb+srv://admin:p%40ss@cluster0.mongodb.net",
          "mongodb+srv://admin:[SECRET]@cluster0.mongodb.net",
        ],
        [
          "git+ssh://git:token123@github.com/langwatch/langwatch.git",
          "git+ssh://git:[SECRET]@github.com/langwatch/langwatch.git",
        ],
        [
          "jdbc:postgresql://svc:9f8e7d6c@10.0.0.4:5432/app",
          "jdbc:postgresql://svc:[SECRET]@10.0.0.4:5432/app",
        ],
        ["HTTPS://USER:PASS@EXAMPLE.COM", "HTTPS://USER:[SECRET]@EXAMPLE.COM"],
      ];
      for (const [input, expected] of cases) {
        expect(redact(input).text).toBe(expected);
      }
    });

    /** @scenario "Text that only looks like a connection URL is left alone" */
    it("leaves alone a colon-slash-slash with no scheme in front of it", () => {
      for (const input of [
        "://user:password@host",
        "no scheme here: user:password@host",
        "See https://app.langwatch.ai/api/trace/abc123?include=spans",
        "mail someone@example.com and read @langwatch/redaction",
      ]) {
        expect(redact(input).text).toBe(input);
      }
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
    // Returning it untouched was a bypass, not a budget: anything past the
    // limit was a reliable way to carry a live key through ingestion unscanned.
    /** @scenario "A payload past the scan budget is still scanned" */
    it("slices it and still redacts the key inside", () => {
      const input = `AKIAIOSFODNN7EXAMPLE ${"x".repeat(SCAN_BUDGET + 1)}`;
      const { text, redactedCount } = redact(input);
      expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(redactedCount).toBe(1);
      expect(text).toHaveLength(input.length - "AKIAIOSFODNN7EXAMPLE".length + "[SECRET]".length);
    });

    it("finds a key that sits past the first slice boundary", () => {
      const input = `${"x".repeat(SCAN_BUDGET + 10_000)} AKIAIOSFODNN7EXAMPLE tail`;
      const { text, redactedCount } = redact(input);
      expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(redactedCount).toBe(1);
      expect(text.endsWith(" [SECRET] tail")).toBe(true);
    });

    // A boundary landing mid-token would be the same leak the slicing exists
    // to close: neither half matches, so the credential passes through in two
    // readable pieces. Cuts land on whitespace, so walking a key across the
    // boundary region must never produce one.
    /** @scenario "A credential straddling a slice boundary is still redacted" */
    it("never splits a credential across two slices", () => {
      const results = [-40, -20, -1, 0, 1, 20, 40].map((offset) => {
        const filler = "x ".repeat((SCAN_BUDGET + offset) / 2);
        const { text, redactedCount } = redact(`${filler}AKIAIOSFODNN7EXAMPLE tail`);
        return { offset, redactedCount, survived: text.includes("AKIAIOSFO") };
      });
      expect(results.filter((r) => r.survived)).toEqual([]);
      // Exactly one replacement everywhere: a split would give zero, and a
      // double-counted overlap would give two.
      expect(results.filter((r) => r.redactedCount !== 1)).toEqual([]);
    });

    // A PEM block spans newlines by design, so whitespace alone does not keep
    // it whole; an unterminated BEGIN pulls its END into the same slice.
    // A run with no whitespace at all must still terminate and stay bounded:
    // hunting forward forever for a cut point would rebuild the unbounded scan
    // the budget exists to prevent.
    it("stays bounded when the payload carries no whitespace", () => {
      const unbroken = "x".repeat(1_000_000);
      expect(redact(unbroken).text).toBe(unbroken);
    });

    /** @scenario "A PEM block straddling a slice boundary is still redacted" */
    it("keeps a PEM block whole across a boundary", () => {
      const pem = pemBlock("PRIVATE KEY", "MIIEvQIBADANBgkqh\n".repeat(40).trimEnd());
      const input = `${"z ".repeat(SCAN_BUDGET / 2 - 5)}${pem} tail`;
      const { text, redactedCount } = redact(input);
      expect(text).not.toContain("MIIEvQIBADANBgkqh");
      expect(redactedCount).toBe(1);
    });
  });

  describe("given a modern base64url provider key", () => {
    it("redacts the whole key, not just a leading alphanumeric run", () => {
      // `_` and `-` mid-body, and the body has no inner word boundary: the
      // shape that slipped past the old `sk-(?:proj-)?[A-Za-z0-9]{20,}\b` rule.
      const key = "sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xYaB-cD_eF";
      const { text } = redact(`here is my key ${key} thanks`);
      expect(text).toBe("here is my key [SECRET] thanks");
      expect(text).not.toContain("sk-proj-");
      expect(text).not.toContain("aB3dEf");
    });
  });

  describe("given a greedy custom pattern inside a JSON string", () => {
    it("redacts only the value and leaves the closing quote and JSON intact", () => {
      const custom = compileSecretPatterns(["sk-.*"]);
      const json = '{"api_key":"sk-proj-abc123def456","model":"gpt-5-mini"}';
      const { text, redactedCount } = redact(json, custom);
      expect(text).toBe('{"api_key":"[SECRET]","model":"gpt-5-mini"}');
      expect(redactedCount).toBe(1);
    });
  });

  describe("given a custom pattern", () => {
    it("redacts a company-specific token shape", () => {
      const custom = compileSecretPatterns(["acme_live_[a-z0-9]{8,}"]);
      const { text, redactedCount } = redact("token acme_live_abcd1234 end", custom);
      expect(text).toBe("token [SECRET] end");
      expect(redactedCount).toBe(1);
    });
  });
});

/**
 * Synthetic credentials only. Every value below was invented for this file: the
 * shapes are real, the bodies are not, so a scanner that finds one here has
 * found nothing.
 */
describe("redactSecretsInText, beyond the known-vendor list", () => {
  describe("given a key from a vendor with no built-in rule", () => {
    /** @scenario "A key from a vendor with no built-in rule is redacted on shape alone" */
    it("redacts it and keeps the sentence around it", () => {
      const prompt =
        "I had to kill the other exploring agent, key now: " +
        "zyq_8fK2mQ7pXvL4nR9sT1wZ3yB6cD0eG5hJ2kM4pQ7rS9t";
      const { text, redactedCount } = redact(prompt);

      expect(text).toBe("I had to kill the other exploring agent, key now: [SECRET]");
      expect(redactedCount).toBe(1);
    });

    it("redacts it with no surrounding context at all", () => {
      const { text } = redact("zyq_8fK2mQ7pXvL4nR9sT1wZ3yB6cD0eG5hJ2kM4pQ7rS9t");
      expect(text).toBe("[SECRET]");
    });
  });

  describe("given credentials from widely used developer services", () => {
    const vendorKeys: Array<[string, string]> = [
      ["GitLab", `GITLAB_TOKEN=glpat-${BODY.slice(0, 21)}`],
      ["npm", `npm_${BODY.slice(0, 36)}`],
      ["Docker Hub", `dckr_pat_${BODY.slice(0, 28)}`],
      ["Shopify", `shpat_${HEX}`],
      ["SendGrid", `SG.${BODY.slice(0, 22)}.${BODY.slice(0, 43)}`],
      ["Hugging Face", `hf_${BODY.slice(0, 34)}`],
      ["Groq", `gsk_${BODY.slice(0, 47)}`],
      ["Perplexity", `pplx-${BODY.slice(0, 40)}`],
      ["Replicate", `r8_${BODY.slice(0, 37)}`],
      ["xAI", `xai-${BODY.slice(0, 47)}`],
      ["Notion", `ntn_${BODY.slice(0, 40)}`],
      ["DigitalOcean", `dop_v1_${HEX}${HEX}`],
      ["Figma", `figd_${BODY.slice(0, 36)}`],
      ["Square", `sq0atp-${BODY.slice(0, 22)}`],
      ["Mailgun", `key-${HEX}`],
      ["Resend", `re_${BODY.slice(0, 24)}`],
      ["PostHog", `phx_${BODY.slice(0, 36)}`],
      ["Linear", `lin_api_${BODY.slice(0, 40)}`],
      ["Google OAuth", `ya29.${BODY.slice(0, 28)}`],
      ["Supabase", `sbp_${HEX}${HEX.slice(0, 8)}`],
      ["Telegram", `123456789:AA${BODY.slice(0, 33)}`],
      ["Airtable", `pat${BODY.slice(0, 14)}.${HEX}${HEX}`],
    ];

    /** @scenario "Widely used vendor credentials are redacted" */
    it("redacts every one of them", () => {
      const survived = vendorKeys.filter(([, key]) => redact(key).redactedCount === 0);
      expect(survived.map(([vendor]) => vendor)).toEqual([]);
    });
  });

  describe("given a key minted by LangWatch itself", () => {
    // Our own tokens are `{prefix}{lookupId}_{secret}`. Matching on the prefix
    // rather than the body means a truncated one still redacts; `ik-lw-` used
    // to be covered by nothing at all, and `sk-lw-` only by the generic `sk-`
    // rule once the body reached 20 characters.
    const ownKeys: Array<[string, string]> = [
      ["API key", `sk-lw-${BODY.slice(0, 12)}_${BODY.slice(0, 32)}`],
      ["ingest key", `ik-lw-${BODY.slice(0, 12)}_${BODY.slice(0, 32)}`],
      ["legacy personal access token", `pat-lw-${BODY.slice(0, 12)}_${BODY}`],
      ["a short API key", "sk-lw-123af"],
      ["a short ingest key", "ik-lw-123af"],
      ["a short legacy token", "pat-lw-123af"],
    ];

    /** @scenario "A key minted by LangWatch is redacted on its prefix" */
    it("redacts every one of them, however short the body", () => {
      const survived = ownKeys.filter(([, key]) => redact(key).redactedCount === 0);
      expect(survived.map(([kind]) => kind)).toEqual([]);
    });
  });

  describe("given a prefixed key whose body is all hexadecimal", () => {
    /** @scenario "A vendor-prefixed key with an all-hex body is redacted" */
    it("redacts it when a credential segment names it as one", () => {
      expect(redact(`acme_live_${HEX}`).text).toBe("[SECRET]");
      expect(redact(`widget_test_${HEX}`).text).toBe("[SECRET]");
      expect(redact(`store_secret_${HEX}`).text).toBe("[SECRET]");
    });

    /** @scenario "An identifier with an all-hex body is left alone" */
    it("leaves an identifier alone even when it carries the same segment", () => {
      const commit = "commit_key_51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5";
      expect(redact(commit).text).toBe(commit);
      expect(redact(`trace_token_${HEX}aabbccdd`).redactedCount).toBe(0);
    });
  });

  describe("given credentials the vendor list had missed", () => {
    const missed: Array<[string, string]> = [
      ["Google OAuth client secret", `GOCSPX-${BODY.slice(0, 24)}`],
      ["LangWatch virtual key", `vk-lw-${BODY.slice(0, 12)}_${BODY.slice(0, 32)}`],
      ["a short LangWatch virtual key", "vk-lw-123af"],
      ["Metabase key", `mb_${BODY.slice(0, 44)}`],
      ["an Authorization Token header", `Authorization: Token ${BODY.slice(0, 32)}`],
      ["an Okta SSWS Authorization header", `Authorization: SSWS ${BODY.slice(0, 32)}`],
      ["an Opsgenie GenieKey header", `Authorization: GenieKey ${BODY.slice(0, 32)}`],
      ["a Splunk header", `Authorization: Splunk ${BODY.slice(0, 32)}`],
      ["an OAuth header", `Authorization: OAuth ${BODY.slice(0, 32)}`],
      ["an encrypted PEM block", pemBlock("ENCRYPTED PRIVATE KEY", "MIIabc")],
      ["a PGP private key block", pemBlock("PGP PRIVATE KEY BLOCK", "lQOYBF")],
      ["a PuTTY private key", "PuTTY-User-Key-File-3: ssh-rsa\nPrivate-Lines: 8\nAAAABBBB\n\ntail"],
      ["an embedded kubeconfig key", `client-key-data: ${BODY.slice(0, 44)}`],
      ["an embedded kubeconfig certificate", `client-certificate-data: ${BODY.slice(0, 44)}`],
    ];

    /** @scenario "Credentials the vendor list had missed are redacted" */
    it("redacts every one of them", () => {
      const survived = missed.filter(([, value]) => redact(value).redactedCount === 0);
      expect(survived.map(([label]) => label)).toEqual([]);
    });

    // `vk-lw-` was reaching only the generic shape rule, so it survived on a
    // short body; `PGP PRIVATE KEY BLOCK` broke the PEM anchor on its suffix.
    it("still redacts the credentials that already worked", () => {
      expect(redact(`phx_${BODY.slice(0, 36)}`).redactedCount).toBe(1);
      expect(redact(`Bearer ${BODY.slice(0, 32)}`).redactedCount).toBe(1);
      expect(redact(pemBlock("PRIVATE KEY", "MIIabc")).redactedCount).toBe(1);
    });
  });

  describe("given a key whose body is standard base64", () => {
    // `+` and `/` landing early in the body used to cut the match short of the
    // length floor, so the key was missed. Measured at a 57% miss rate for
    // standard-base64 bodies against 0.5% for base64url.
    /** @scenario "A key with a standard base64 body is redacted" */
    it("redacts it the same as a base64url body", () => {
      expect(redact("acme_aB3dEf+gHi/jKlMnOpQrStUvWx0123456789xY").text).toBe("[SECRET]");
      expect(redact("acme_aB+dEf/gHi+jKlMnOpQrStUvWx0123456789xY").text).toBe("[SECRET]");
    });
  });

  describe("given a key whose prefix is upper or mixed case", () => {
    /** @scenario "A key with an upper or mixed case prefix is redacted" */
    it("redacts it on the same shape rule as a lowercase prefix", () => {
      expect(redact(`LW_${BODY.slice(0, 43)}`).text).toBe("[SECRET]");
      expect(redact(`Xy_${BODY.slice(0, 38)}`).text).toBe("[SECRET]");
    });

    /** @scenario "An environment variable name is not mistaken for a key" */
    it("leaves a bare environment variable name readable", () => {
      for (const name of [
        "AWS_SECRET_ACCESS_KEY",
        "DATABASE_URL_PRODUCTION",
        "LANGWATCH_TELEMETRY_ENDPOINT_OVERRIDE_URL",
      ]) {
        expect(redact(name).text).toBe(name);
      }
    });

    it("still recognises an uppercase digest prefix as a digest", () => {
      const integrity = `SHA512-${BODY.slice(0, 43)}`;
      expect(redact(integrity).text).toBe(integrity);
    });
  });

  describe("given a credential named in prose and then given a value", () => {
    /** @scenario "A credential introduced by name in free text is redacted" */
    it("redacts the value and leaves the words that introduce it", () => {
      const { text } = redact("my api key: h9Kd2Lm4Nq7Pr1Ts5Vw8Xz3");
      expect(text).toBe("my api key: [SECRET]");
    });

    it("redacts a value whose shape alone gives nothing away", () => {
      // Bare lowercase hex: an MD5 digest and a Twilio auth token are the same
      // shape, so only the keyword can tell them apart.
      const { text } = redact("TWILIO_AUTH_TOKEN=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
      expect(text).toBe("TWILIO_AUTH_TOKEN=[SECRET]");
    });

    it("redacts a credential field inside a JSON body", () => {
      const { text } = redact('{"client_secret":"h9Kd2Lm4Nq7Pr1Ts5Vw8Xz3"}');
      expect(text).toBe('{"client_secret":"[SECRET]"}');
    });

    it("redacts basic authorization credentials", () => {
      const { text } = redact("Authorization: Basic dXNlcjpzdXBlcnNlY3JldDEyMw==");
      expect(text).toBe("Authorization: Basic [SECRET]");
    });
  });
});

/**
 * The limit on all of the above. Over-redaction is a bug of the same severity
 * as a leak: a terminal replay full of `[SECRET]` where the commit hashes and
 * file paths used to be is not a usable trace. Every string here is the kind of
 * thing that genuinely shows up in a coding-agent transcript.
 */
describe("redactSecretsInText, given text that only looks like secrets", () => {
  const leaveAlone: Array<[string, string]> = [
    ["a commit hash", "fix in commit 51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5"],
    ["short commit hashes", "reverted 5ebf89d6f4 and f05d495818"],
    ["a UUID", "id 550e8400-e29b-41d4-a716-446655440000 done"],
    ["an uppercase UUID", "ID 550E8400-E29B-41D4-A716-446655440000 done"],
    ["trace and span ids", "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"],
    ["ISO timestamps", "started 2026-08-10T14:32:11.482Z ended 14:32:19.005Z"],
    [
      "a source path",
      "see packages/features/metric/server/src/services/metric-request-collection.service.ts",
    ],
    ["a path with a line number", "packages/redaction/src/secrets.ts:142"],
    [
      "a URL with query parameters",
      "https://app.langwatch.ai/project/my-project/traces?spanId=abc123",
    ],
    [
      "a base64 data URI",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ],
    ["model names", "compared claude-opus-5 with gpt-5-mini and claude-3-5-sonnet-20241022"],
    ["a bedrock model id", "us.anthropic.claude-opus-4-20250514-v1:0"],
    ["semver bumps", "bumped langwatch from 1.2.1 to 2.6.0 and web to 3.9.0"],
    [
      "a subresource integrity hash",
      "integrity sha512-4Zj6ZL6qF9pQwEr7tYu2Io1pAsDfGh3JkL5mNb8Vc9X",
    ],
    [
      "a docker image digest",
      "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    ],
    ["a content-hashed asset", "dist/assets/index-DxK9mQ2p.js 1,234.56 kB"],
    ["a kubernetes pod name", "pod/langwatch-app-7d9f8c6b5d-x2mnq restarted"],
    ["an AWS ARN", "arn:aws:iam::123456789012:role/langwatch-app-runtime-role"],
    ["a snake_case identifier", "const user_id_1234567890abcdef = row.id;"],
    ["reading an environment variable", "const apiKey = process.env.OPENAI_API_KEY;"],
    ["a property access chain", "const token = config.auth.accessToken.value;"],
    [
      "a path following a credential keyword",
      "token: src/server/app-layer/traces/log-request-collection.service.ts",
    ],
    ["an absolute path", "secret = /etc/langwatch/credentials.yaml"],
    ["an environment variable reference", "export ACME_API_KEY=$ACME_API_KEY"],
    ["a documented placeholder", "OPENAI_API_KEY=your-api-key-here"],
    ["a masked value", "api_key: xxxxxxxxxxxxxxxxxxxx"],
    ["a documented header", "Send the Authorization: Basic <base64-credentials> header."],
    ["a sentence about basic auth", "This uses Basic authentication over TLS."],
    ["a documented bearer header", "Send the Authorization: Bearer <your-token> header."],
    ["prose using the word key", "The key insight is that the token budget was the bottleneck."],
    ["advice about a key", "Set the api key in your .env file before running the tests"],
    ["an API version field", '{"api_version": "2024-10-21", "model": "claude-opus-5"}'],
    ["a request id header", "X-Request-Id: 7f3a9b2c-1d4e-5f6a-8b9c-0d1e2f3a4b5c"],
    ["usage attributes", "gen_ai.usage.input_tokens=15234 gen_ai.usage.output_tokens=892"],
    ["a branch name", "feat/coding-agent-session-events and issue6124/red-team-native"],
    ["already-redacted text", "key now: [SECRET] and token: [SECRET]"],
    [
      "an ordinary agent sentence",
      "I had to kill the other exploring agent because it was burning tokens on the same files.",
    ],
    // Bare high-entropy tokens carrying no prefix. Deliberately untouched: a
    // bare 32-hex credential and a trace id are byte-for-byte identical, so
    // redacting the class would blank the identifiers the product is built to
    // show. Detection needs a prefix or a keyword, and these have neither.
    ["a bare 32-hex token", HEX],
    ["a bare 64-hex token", `${HEX}${HEX}`],
    ["a bare base62 token", BODY],
    ["a bare 21-character nanoid", "V1StGXR8Z5jdHi6BmyT"],
    ["a bare 32-character nanoid", "V1StGXR8Z5jdHi6BmyTV1StGXR8Z5jdH"],
    ["a bare git SHA", "51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5"],
    ["a bare trace id", "4bf92f3577b34da6a3ce929d0e0e4736"],
    ["a bare span id", "00f067aa0ba902b7"],
    // Environment variable NAMES. Uppercase-underscore is also the shape the
    // shape rule now accepts as a prefix, so these prove the length floor and
    // the character-mix gate still keep a bare name readable.
    ["an AWS environment variable name", "AWS_SECRET_ACCESS_KEY"],
    ["a database environment variable name", "DATABASE_URL_PRODUCTION"],
    ["a long environment variable name", "LANGWATCH_TELEMETRY_ENDPOINT_OVERRIDE_URL"],
    // Identifier prefixes in front of a hex body. The prefixed-hex rule needs a
    // credential segment, and refuses these prefixes even when one is present.
    ["a prefixed commit id", "commit_51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5"],
    ["a prefixed trace id", "trace_4bf92f3577b34da6a3ce929d0e0e4736"],
    ["a prefixed digest", `digest_${HEX}`],
    [
      "an identifier prefix carrying a credential segment",
      "commit_key_51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5",
    ],
    ["a trace prefix carrying a credential segment", `trace_token_${HEX}aabbccdd`],
    // Ordinary words that merely contain a vendor prefix as a substring.
    [
      "words containing sk- and ask-",
      "risk-based scoring, disk-usage report, ask-me-anything, mask-sensitive-fields",
    ],
    ["a transcript tag", "<task-notification> and <task-progress>"],
    ["package versions", "@langwatch/gateway-server@3.12.0 and pnpm@10.4.1"],
    // A PostHog project key ships inside published web bundles by design,
    // so blanking it hides telemetry configuration and protects nothing.
    ["a public PostHog project key", `phc_${BODY.slice(0, 43)}`],
    // Record ids. `prefix_<random body>` is how this product and the APIs it
    // talks to mint an id, which is the shape a key is minted in and carries
    // the same entropy, so the prefix is the only thing telling them apart. A
    // sweep of real traces found every one of these being eaten.
    ["a project id", `project_${BODY.slice(0, 29)}`],
    ["a card id", `card_${BODY.slice(0, 29)}`],
    ["a scenario id", `scenario_${BODY.slice(0, 29)}`],
    ["a langy conversation id", `langyconv_${BODY.slice(0, 29)}`],
    ["a provider id", `provider_${BODY.slice(0, 29)}`],
    ["an OpenAI completion id", `chatcmpl-${BODY.slice(0, 29)}`],
    ["an Anthropic tool use id", `toolu_${BODY.slice(0, 29)}`],
    ["a thread id", `thread_${BODY.slice(0, 29)}`],
    ["a run id", `run_${BODY.slice(0, 29)}`],
    ["an assistant id", `asst_${BODY.slice(0, 29)}`],
    // Prose. `key is ...` used to be read as a cue, which made these two
    // ordinary sentences lose everything after the credential word.
    [
      "prose about a digest of a key",
      "a bare digest of an API key is offline-checkable against a list",
    ],
    [
      "prose about an authorization header",
      "the Authorization header is attacker-controlled and can be killed",
    ],
    // A bare `key` field. JSON payloads, OTLP attributes and config
    // dictionaries all name a map entry `key`, so reading the word itself as
    // proof of a credential blanked ids and hashes at ingestion. Each of these
    // is a value the corpus above already keeps on its own, which is what made
    // the cue the only thing destroying them.
    ["a key field holding a content hash", `{"key":"${"a1b2c3d4e5f6".repeat(3)}"}`],
    ["a key field holding a UUID", '{"key":"550e8400-e29b-41d4-a716-446655440000"}'],
    ["a key field holding a record id", `{"key":"project_${BODY.slice(0, 29)}"}`],
    ["a key entry in an OTLP attribute pair", '{"key":"gen_ai.usage.input_tokens"}'],
    ["a key field in YAML holding a commit", `key: ${"9f8e7d6c5b4a3928".repeat(2)}`],
  ];

  /** @scenario "A bare key field holding an identifier is left alone" */
  it("keeps a key field whose value is an identifier, on its own and in a map", () => {
    const hash = "a1b2c3d4e5f6".repeat(3);
    expect(redact(`{"key":"${hash}"}`).text).toBe(`{"key":"${hash}"}`);
    expect(redact(`key: ${hash}`).text).toBe(`key: ${hash}`);
  });

  /** @scenario "A qualified key name is still a credential" */
  it("still redacts once a credential word qualifies the key", () => {
    const material = "a1b2c3d4e5f6".repeat(3);
    for (const name of ["api_key", "secret_key", "apiKey", "x-api-key"]) {
      expect(redact(`${name}: ${material}`).text).toBe(`${name}: [SECRET]`);
    }
  });

  /** @scenario "Ordinary identifiers are never mistaken for secrets" */
  it("leaves every one of them exactly as written", () => {
    const mangled = leaveAlone
      .filter(([, input]) => redact(input).text !== input)
      .map(([label, input]) => `${label}: ${redact(input).text}`);
    expect(mangled).toEqual([]);
  });

  /** @scenario "A placeholder standing in for a credential stays readable" */
  it("leaves a placeholder and an environment variable reference readable", () => {
    expect(redact("OPENAI_API_KEY=your-api-key-here").text).toBe(
      "OPENAI_API_KEY=your-api-key-here",
    );
    expect(redact("export ACME_API_KEY=$ACME_API_KEY").text).toBe(
      "export ACME_API_KEY=$ACME_API_KEY",
    );
  });
});

describe("redactSecretsInText, given a payload the size of the scan budget", () => {
  /** @scenario "A large payload is scanned within the ingestion budget" */
  it("completes well inside the ingestion budget", () => {
    const chunk =
      "The agent read packages/features/trace/server/src/services/trace-legacy-read.service.ts at " +
      "2026-08-10T14:32:11.482Z, commit 51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5, " +
      'model claude-opus-5, {"input_tokens":15234,"cost_usd":0.0412}\n';
    const payload = chunk.repeat(Math.ceil(200_000 / chunk.length));

    const startedAt = performance.now();
    const { redactedCount } = redact(payload.slice(0, 200_000));
    const elapsedMs = performance.now() - startedAt;

    expect(redactedCount).toBe(0);
    expect(elapsedMs).toBeLessThan(2_000);
  });

  describe("when the input is shaped to stall a careless pattern", () => {
    const adversarial: Array<[string, string]> = [
      ["a long underscore run", "a_".repeat(50_000)],
      ["a long hyphen run", "a-".repeat(50_000)],
      ["a keyword followed by filler", `api_key: ${"a".repeat(100_000)}`],
      ["repeated keywords", "password=".repeat(20_000)],
      ["repeated open quotes", `${'api_key:"'.repeat(20_000)}x`],
      // Lowercase prose is the worst case for the connection-URL rule, whose
      // scheme is a run of letters. With the scheme leading the match every
      // letter in the text started a scan for a "://" that is not there.
      ["lowercase prose with no URL in it", "the dashboard stopped loading ".repeat(8_000)],
      ["one URL per line", "postgres://svc:pw@10.0.0.4:5432/app\n".repeat(6_000)],
      ["a scheme-shaped run with no separator", `${"a".repeat(100_000)}://`],
    ];

    for (const [label, input] of adversarial) {
      it(`stays linear on ${label}`, () => {
        const startedAt = performance.now();
        redact(input.slice(0, 250_000));
        expect(performance.now() - startedAt).toBeLessThan(2_000);
      });
    }
  });
});

/**
 * A customer wrote `sk-.*` because the built-in rules did not cover their
 * provider, and it shredded their own transcripts: it fired inside "task-" and
 * then ran to the end of the line. These pin both halves of the fix, and the
 * last one pins that the pattern still does the job it was written for.
 */
describe("redactSecretsInText, given a hand-written custom pattern", () => {
  const userPattern = () => compileSecretPatterns(["sk-.*"]);

  describe("when ordinary words merely contain the pattern's literal", () => {
    const transcriptText = [
      "<task-notification>",
      "</task-notification>",
      "<task-notification>agent finished</task-notification> and then it stopped",
      "<system-reminder>The user has not replied yet.</system-reminder>",
      "TaskCreate returned a new agent id",
      "we took a risk-based approach to the migration",
      "disk-usage is at 84% on the clickhouse node",
      "ask-follow-up was disabled for this run",
      "the mask-sensitive-fields flag is on",
      "flask-restful is not a dependency here",
      "moved the desk-check to the review step",
    ];

    /** @scenario "A custom pattern does not fire inside an ordinary word" */
    it("leaves every one of them exactly as written", () => {
      const custom = userPattern();
      const mangled = transcriptText.filter((line) => redact(line, custom).text !== line);
      expect(mangled).toEqual([]);
    });

    it("leaves them alone under the built-in rules too", () => {
      const mangled = transcriptText.filter((line) => redact(line).text !== line);
      expect(mangled).toEqual([]);
    });
  });

  describe("when the pattern ends in a wildcard", () => {
    /** @scenario "A custom pattern does not swallow the rest of the line" */
    it("replaces the credential and leaves the words after it", () => {
      const { text } = redact(
        "the key is sk-proj-abc123def456 and the model is gpt-5-mini",
        userPattern(),
      );
      expect(text).toBe("the key is [SECRET] and the model is gpt-5-mini");
    });

    it("stops at the closing quote inside a JSON body", () => {
      const { text, redactedCount } = redact(
        '{"api_key":"sk-proj-abc123def456","model":"gpt-5-mini"}',
        userPattern(),
      );
      expect(text).toBe('{"api_key":"[SECRET]","model":"gpt-5-mini"}');
      expect(redactedCount).toBe(1);
    });
  });

  describe("when the credential the pattern was written for shows up", () => {
    /** @scenario "A custom pattern still redacts the credential it was written for" */
    it("redacts it", () => {
      const { text } = redact("sk-notarealprovider-abc123def456", userPattern());
      expect(text).toBe("[SECRET]");
    });
  });

  describe("when the author anchored the pattern themselves", () => {
    it("compiles it exactly as written", () => {
      // A leading \b means the author already said where it may start, so the
      // guard must not be added on top and change what they asked for.
      const custom = compileSecretPatterns([String.raw`\bacme_[a-z0-9]{8,}`]);
      expect(redact("token acme_abcd1234 end", custom).text).toBe("token [SECRET] end");
    });
  });
});

describe("overBroadSecretPatternProbe", () => {
  describe("given a pattern that would match ordinary text", () => {
    /** @scenario "A pattern that would match ordinary text is reported as too broad" */
    it("reports the ordinary text it would erase", () => {
      expect(overBroadSecretPatternProbe(".*")).not.toBeNull();
      expect(overBroadSecretPatternProbe("\\w+")).not.toBeNull();
      expect(overBroadSecretPatternProbe("[a-z]+")).not.toBeNull();
      expect(overBroadSecretPatternProbe("[\\s\\S]*")).not.toBeNull();
    });
  });

  describe("given a pattern that describes an actual credential", () => {
    for (const pattern of [
      "acme_live_[a-z0-9]{8,}",
      "sk-[A-Za-z0-9]{20,}",
      String.raw`\bzyq_[A-Za-z0-9]{40}`,
      // Safe once the compile guard adds the word boundary this probe shares.
      "sk-.*",
    ]) {
      it(`accepts ${pattern}`, () => {
        expect(overBroadSecretPatternProbe(pattern)).toBeNull();
      });
    }
  });

  describe("given a pattern that does not compile", () => {
    it("defers to the caller's own compile check", () => {
      expect(overBroadSecretPatternProbe("[unclosed")).toBeNull();
    });
  });

  describe("given a blank pattern", () => {
    // An unfinished row in the settings UI, not a pattern that eats everything.
    // Guarded, an empty pattern matches at index 0 of every probe, so without
    // the blank check the customer is told their empty row is over-broad.
    it("reports nothing, so an empty row is not an error", () => {
      expect(overBroadSecretPatternProbe("")).toBeNull();
      expect(overBroadSecretPatternProbe("   ")).toBeNull();
    });
  });

  describe("given a broad pattern wrapped in a named capture group", () => {
    // `(?<name>` opens the same way a lookbehind does. Reading it as an anchor
    // skipped the word-boundary guard, which is the whole defence here.
    it("guards it like any other unanchored pattern", () => {
      expect(overBroadSecretPatternProbe("(?<key>sk-.*)")).toBeNull();
      expect(
        redact("a <task-notification> here", compileSecretPatterns(["(?<key>sk-.*)"])).text,
      ).toBe("a <task-notification> here");
    });

    // A real lookbehind is still the author's own anchor, so it is compiled
    // exactly as written and the probe reports what it would really erase.
    it("still treats a real lookbehind as the author's own anchor", () => {
      expect(overBroadSecretPatternProbe("(?<=the )user")).toBe(
        "the user asked the agent to summarise the meeting notes",
      );
    });
  });
});

describe("isSensitiveAttributeKey, given a camelCase name", () => {
  // The separator-only rule was blind to every camelCase and PascalCase name,
  // which is most of them in a JSON payload. `SecretString` is AWS Secrets
  // Manager's own field for the secret itself.
  describe("when the name says it holds a credential", () => {
    /** @scenario "A camelCase credential name is recognised" */
    it("recognises it", () => {
      const missed = [
        "signingSecret",
        "bearerToken",
        "webhookSecret",
        "masterKey",
        "encryptionKey",
        "SecretAccessKey",
        "AccessKeyId",
        "SecretString",
        "SecretBinary",
        "AuthorizationToken",
        "PasswordHash",
        "verificationToken",
        "rootPassword",
        "credentialsJson",
      ].filter((name) => !isSensitiveAttributeKey(name));
      expect(missed).toEqual([]);
    });
  });

  describe("when the name merely contains key or token", () => {
    // Bare `key` and `token` are far more often an id or a count, so they need
    // a qualifying word in front before they name a credential.
    /** @scenario "An ordinary name containing key or token is not a credential" */
    it("leaves it alone", () => {
      const fired = [
        "idempotency_key",
        "partition_key",
        "cacheKey",
        "sortKey",
        "primaryKey",
        "gen_ai.usage.input_tokens",
        "tokenCount",
        "keyboardLayout",
        "monkeyPatch",
      ].filter((name) => isSensitiveAttributeKey(name));
      expect(fired).toEqual([]);
    });
  });
});

describe("redactSecretsInText, given a whitespace separator", () => {
  describe("when the value looks like key material", () => {
    /** @scenario "A credential after a whitespace separator is redacted" */
    it("redacts it", () => {
      expect(redact(`Authorization ${BODY.slice(0, 30)}`).redactedCount).toBe(1);
      expect(redact(`api key ${HEX}`).text).toBe("api key [SECRET]");
    });
  });

  describe("when the words after it are ordinary prose", () => {
    // Accepting whitespace on the same terms as `:` matched thousands of prose
    // spans on a real corpus. The value has to look like key material itself.
    /** @scenario "Prose following a credential word is left alone" */
    it("leaves the sentence intact", () => {
      const prose = [
        "a bare digest of an API key is offline-checkable against a list",
        "the Authorization header is attacker-controlled and can be killed",
        "the secret sauce here is careful measurement of everything",
        "your password should be long and memorable and never reused",
      ];
      const mangled = prose.filter((line) => redact(line).text !== line);
      expect(mangled).toEqual([]);
    });
  });

  describe("when the payload carries a JSON-escaped newline", () => {
    // Span content arrives JSON-encoded, so a literal two-character `\n` sits
    // in the text. A value running through one crossed logical lines and got
    // past the `$VAR` and code-expression guards.
    /** @scenario "A JSON-escaped newline does not extend a credential value" */
    it("stops the value at the escape, as it does at a real newline", () => {
      const escaped = "api_key = $OPENAI_API_KEY\\nnext line here";
      // The fixture must carry the two characters a backslash and an n, not a
      // real newline: a real one already terminated the value before the fix,
      // so a test built on one passes without exercising anything.
      expect(escaped).toContain("\\n");
      expect(escaped.includes("\u000a")).toBe(false);
      expect(redact(escaped).text).toBe(escaped);

      const withRealNewline = "api_key = $OPENAI_API_KEY\nnext line here";
      expect(redact(withRealNewline).text).toBe(withRealNewline);

      const terraform = "github_token_secret = local.github_token_secret_name";
      expect(redact(terraform).text).toBe(terraform);
    });
  });

  describe("given a skip list", () => {
    const RUN_ID = "unlisted_0005FFcHZ7IBvPE1OSWymml0ikKqB";

    it("leaves the named rules out of the scan", () => {
      expect(redact(RUN_ID).text).toBe("[SECRET]");
      expect(
        redactSecretsInText({
          text: RUN_ID,
          skipRuleIds: SHAPE_ONLY_SECRET_RULE_IDS,
        }).text,
      ).toBe(RUN_ID);
    });

    it("keeps every other rule running", () => {
      const key = `sk-ant-api03-${BODY}`;
      expect(
        redactSecretsInText({
          text: key,
          skipRuleIds: SHAPE_ONLY_SECRET_RULE_IDS,
        }).text,
      ).toBe("[SECRET]");
    });

    // A custom pattern is the customer's own decision about their own data, so
    // a skip list the platform passes must not reach it.
    it("keeps the custom patterns running", () => {
      expect(
        redactSecretsInText({
          text: RUN_ID,
          customPatterns: compileSecretPatterns(["unlisted_[A-Za-z0-9]+"]),
          skipRuleIds: SHAPE_ONLY_SECRET_RULE_IDS,
        }).text,
      ).toBe("[SECRET]");
    });

    it("scans a payload over the budget with the same skip list", () => {
      const filler = "x".repeat(SCAN_BUDGET);
      const { text } = redactSecretsInText({
        text: `${filler} ${RUN_ID}`,
        skipRuleIds: SHAPE_ONLY_SECRET_RULE_IDS,
      });
      expect(text).toContain(RUN_ID);
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
    for (const key of ["model", "latency", "gen_ai.usage.input_tokens", "span.name"]) {
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

  it("lists the rules that catch a vendor nobody added and a named value", () => {
    const ids = BUILTIN_SECRET_RULES.map((rule) => rule.id);
    expect(ids).toContain("vendor_api_key");
    expect(ids).toContain("shaped_api_key");
    expect(ids).toContain("sensitive_assignment");
  });
});

describe("SHAPE_ONLY_SECRET_RULE_IDS", () => {
  // A skip list is silent when it misses: a renamed rule leaves the caller
  // asking for a rule that no longer exists, the scan runs every rule, and
  // nothing says so until an id is eaten in production again.
  it("names rules that exist", () => {
    const ids = new Set(BUILTIN_SECRET_RULES.map((rule) => rule.id));
    const unknown = SHAPE_ONLY_SECRET_RULE_IDS.filter((id) => !ids.has(id));
    expect(unknown).toEqual([]);
  });
});

describe("detectSecretsInText", () => {
  describe("given text with a provider key", () => {
    it("reports the rule that matched and where, without altering the text", () => {
      const input = "key sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xY here";
      const matches = detectSecretsInText({ text: input });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.ruleId).toBe("provider_api_key");
      // The detector never mutates the input.
      expect(input).toContain("sk-proj-");
    });
  });

  describe("given text with a connection URL", () => {
    /** @scenario "A reported connection URL spans the whole URL" */
    it("reports a span that starts at the scheme, not at the colon", () => {
      // The rule reads the scheme in a lookbehind so that it can anchor on the
      // literal, which keeps the scheme out of the regex match. The credential
      // still begins at the scheme, so the reported span has to as well.
      const input = "db postgres://user:hunter2@db.internal:5432/app end";
      const matches = detectSecretsInText({ text: input });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.ruleId).toBe("url_credentials");
      expect(input.slice(matches[0]!.start, matches[0]!.end)).toBe("postgres://user:hunter2@");
    });

    it("starts the span at the scheme that introduces the URL", () => {
      const input = "jdbc:postgresql://svc:9f8e7d6c@10.0.0.4:5432/app";
      const matches = detectSecretsInText({ text: input });
      expect(input.slice(matches[0]!.start, matches[0]!.end)).toBe("postgresql://svc:9f8e7d6c@");
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

  describe("given a skip list", () => {
    // The evaluator reports what redaction scrubs, so the two read the same
    // skip list or they disagree about the same string.
    it("leaves the named rules out of the report", () => {
      const runId = "unlisted_0005FFcHZ7IBvPE1OSWymml0ikKqB";
      expect(detectSecretsInText({ text: runId })).toHaveLength(1);
      expect(
        detectSecretsInText({
          text: runId,
          skipRuleIds: SHAPE_ONLY_SECRET_RULE_IDS,
        }),
      ).toEqual([]);
    });
  });

  describe("given already-redacted text carrying a [SECRET] marker", () => {
    it("does not re-detect the marker as a secret", () => {
      expect(detectSecretsInText({ text: "authorization: [SECRET]" })).toEqual([]);
    });
  });

  describe("given one credential that several rules all recognise", () => {
    /** @scenario "One credential is reported as one leak" */
    it("reports it once, under the most specific rule", () => {
      // Named in prose, vendor-recognisable, and key-shaped all at once.
      const matches = detectSecretsInText({
        text: "api_key: sk-proj-aB3dEf_gHi-jKlMnOpQrStUvWx0123456789xY",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.ruleId).toBe("provider_api_key");
    });

    it("reports an unknown vendor's key once", () => {
      const matches = detectSecretsInText({
        text: "key now: zyq_8fK2mQ7pXvL4nR9sT1wZ3yB6cD0eG5hJ2kM4pQ7rS9t",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.ruleId).toBe("shaped_api_key");
    });

    it("still reports two distinct credentials separately", () => {
      const matches = detectSecretsInText({
        text: `aws AKIAIOSFODNN7EXAMPLE and gitlab glpat-${BODY.slice(0, 21)}`,
      });

      expect(matches.map((match) => match.ruleId).sort()).toEqual([
        "aws_access_key_id",
        "vendor_api_key",
      ]);
    });
  });
});
