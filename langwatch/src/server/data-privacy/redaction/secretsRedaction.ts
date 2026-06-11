/**
 * Native, lightweight secrets redaction for the ingestion pipeline.
 *
 * Scrubs credentials (cloud + provider API keys, JWTs, private-key blocks,
 * database-URL passwords, bearer tokens) out of free text, plus a key-name pass
 * for obviously-sensitive attribute names. Runs in-process per span: no external
 * service, no entropy scanning (too noisy for v1), all patterns precompiled and
 * linear-time. Detected secrets are replaced with the same `[REDACTED]` marker
 * the PII path uses.
 */

/** The placeholder every redaction (secrets + PII) writes in place of a match. */
export const SECRETS_REDACTION_MARKER = "[REDACTED]";
const REPLACEMENT = SECRETS_REDACTION_MARKER;

/** Inputs longer than this are passed through untouched, mirroring the PII size budget. */
const MAX_SCAN_LENGTH = 250_000;

interface ValueRule {
  id: string;
  description: string;
  regex: RegExp;
  /** Builds the replacement for one match; defaults to the full marker. Groups
   *  let a rule keep the non-secret context (scheme/user/host, the `Bearer `
   *  prefix). */
  render?: (...groups: string[]) => string;
}

/**
 * Built-in value patterns. Each regex carries the global flag and is matched
 * only through `String.prototype.replace` (never `.test`/`.exec`, which carry
 * `lastIndex` state on global regexes). Patterns use anchors/boundaries so a
 * secret-shaped substring inside a longer identifier does not fire.
 */
const VALUE_RULES: ValueRule[] = [
  {
    id: "pem_private_key",
    description: "PEM private key block",
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "aws_access_key_id",
    description: "AWS access key id",
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "github_token",
    description: "GitHub token",
    regex: /\b(?:gh[posru]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  {
    id: "anthropic_api_key",
    description: "Anthropic API key",
    regex: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    id: "openai_api_key",
    description: "OpenAI API key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "stripe_secret_key",
    description: "Stripe secret key",
    regex: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: "slack_token",
    description: "Slack token",
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "google_api_key",
    description: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "jwt",
    description: "JSON Web Token",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "url_credentials",
    description: "Password embedded in a connection URL",
    // scheme://user:password@host -> keep everything but the password.
    regex: /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s:@/]+)(@)/gi,
    render: (_m, prefix, _password, at) => `${prefix}${REPLACEMENT}${at}`,
  },
  {
    id: "bearer_token",
    description: "Bearer authorization token",
    regex: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{10,}=*/gi,
    render: (_m, prefix) => `${prefix}${REPLACEMENT}`,
  },
];

/** Public catalog of the built-in value rules, for UI chips and docs. */
export const BUILTIN_SECRET_RULES: readonly {
  id: string;
  description: string;
}[] = VALUE_RULES.map(({ id, description }) => ({ id, description }));

/**
 * Attribute names whose VALUE should always be scrubbed regardless of shape.
 * Non-global (so `.test` is safe) and bounded by `._-` separators so plural or
 * compound metadata keys like `gen_ai.usage.input_tokens` never match `token`.
 */
const SENSITIVE_KEY_REGEX =
  /(?:^|[._-])(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|authorization|auth|bearer|credentials?|private[_-]?key|client[_-]?secret|db[_-]?password|connection[_-]?string|session[_-]?token|refresh[_-]?token|set[_-]?cookie|cookie|x-api-key)(?:$|[._-])/i;

export function isSensitiveAttributeKey(key: string): boolean {
  return SENSITIVE_KEY_REGEX.test(key);
}

/**
 * Compile user-supplied pattern strings into case-insensitive global regexes,
 * silently dropping any that fail to compile (the service validates them with
 * `isSafeRegex` before they are ever stored, so this is a last-resort guard).
 */
export function compileSecretPatterns(patterns: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "gi"));
    } catch {
      // Skip an uncompilable pattern rather than throwing in the hot path.
    }
  }
  return compiled;
}

export interface SecretsRedactionResult {
  text: string;
  redactedCount: number;
}

/**
 * Redact secrets from one string. Runs every built-in value rule, then any
 * caller-supplied custom patterns. Returns the scrubbed text and how many
 * secrets were replaced.
 */
export function redactSecretsInText({
  text,
  customPatterns = [],
}: {
  text: string;
  customPatterns?: readonly RegExp[];
}): SecretsRedactionResult {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_SCAN_LENGTH
  ) {
    return { text, redactedCount: 0 };
  }

  let redactedCount = 0;
  let result = text;

  for (const rule of VALUE_RULES) {
    result = result.replace(rule.regex, (...args: string[]) => {
      redactedCount++;
      return rule.render ? rule.render(...args) : REPLACEMENT;
    });
  }

  for (const pattern of customPatterns) {
    result = result.replace(pattern, () => {
      redactedCount++;
      return REPLACEMENT;
    });
  }

  return { text: result, redactedCount };
}
