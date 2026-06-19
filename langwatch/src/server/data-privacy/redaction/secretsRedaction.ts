/**
 * Native, lightweight secrets redaction for the ingestion pipeline.
 *
 * Scrubs credentials (cloud + provider API keys, JWTs, private-key blocks,
 * database-URL passwords, bearer tokens) out of free text, plus a key-name pass
 * for obviously-sensitive attribute names. Runs in-process per span: no external
 * service, no entropy scanning (too noisy for v1), all patterns precompiled and
 * linear-time. Detected secrets are replaced with the typed `[SECRET]` marker,
 * which the trace view reads back and which keeps the secrets evaluator able to
 * flag a credential that was already scrubbed at ingestion.
 */
import { SECRET_MARKER } from "./markers";

/** The placeholder a redacted secret is replaced with. */
export const SECRETS_REDACTION_MARKER = SECRET_MARKER;
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
    // Provider secret keys share the `sk-` namespace: OpenAI (`sk-proj-...`,
    // legacy `sk-...`), Anthropic (`sk-ant-...`), LangWatch (`sk-lw-...`), and
    // others. The body is base64url, so it includes `_` and `-` and has no inner
    // word boundary; matching the whole token and stopping at the next non-key
    // char catches modern keys a `[A-Za-z0-9]+\b` rule misses.
    id: "provider_api_key",
    description: "Provider API key (sk-...)",
    regex: /\bsk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
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

/**
 * A secret value lives inside a single quoted string (a JSON value, a header
 * line, a log field), so it can never legitimately contain a quote or backtick.
 * We clamp every match at the first such character so a greedy custom pattern
 * like `sk-.*` redacts only the credential and leaves the closing quote (and the
 * rest of the surrounding JSON) intact, instead of swallowing the line. Newlines
 * are deliberately excluded: `.*` already stops at them, and the multi-line PEM
 * rule must keep spanning them. Single-line built-in rules never match a quote,
 * so the clamp is a no-op for them.
 */
const VALUE_BOUNDARY = /["'`]/;

/** Length of `match` up to the first structural boundary char (or its full length). */
function keptLengthAtBoundary(match: string): number {
  const index = match.search(VALUE_BOUNDARY);
  return index === -1 ? match.length : index;
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
      // Rules that keep surrounding context (url password, bearer prefix) are
      // tightly bounded already, so they render verbatim without the clamp.
      if (rule.render) {
        redactedCount++;
        return rule.render(...args);
      }
      const full = args[0] ?? "";
      const kept = keptLengthAtBoundary(full);
      if (kept === 0) return full;
      redactedCount++;
      return REPLACEMENT + full.slice(kept);
    });
  }

  for (const pattern of customPatterns) {
    result = result.replace(pattern, (...args: string[]) => {
      const full = args[0] ?? "";
      const kept = keptLengthAtBoundary(full);
      if (kept === 0) return full;
      redactedCount++;
      return REPLACEMENT + full.slice(kept);
    });
  }

  return { text: result, redactedCount };
}

export interface SecretMatch {
  /** The built-in rule id, or `custom_pattern` for a caller-supplied regex. */
  ruleId: string;
  description: string;
  /** Span of the full match in the original text. */
  start: number;
  end: number;
}

/**
 * Detect secrets in one string WITHOUT redacting it: returns the rule that
 * matched and where, so the secrets evaluator can report a leak (and which
 * kind) while leaving the text alone. Shares the exact rule set used by
 * `redactSecretsInText`, so what the evaluator flags is what redaction scrubs.
 *
 * Uses `matchAll`, which clones the regex internally, so the module-level global
 * rules keep `lastIndex === 0` just like the `.replace` path. Detection scans
 * the original text (redaction rewrites the string between rules), so on rare
 * overlapping matches the count can differ slightly from `redactedCount` — fine
 * for scoring a pass/fail.
 */
export function detectSecretsInText({
  text,
  customPatterns = [],
}: {
  text: string;
  customPatterns?: readonly RegExp[];
}): SecretMatch[] {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_SCAN_LENGTH
  ) {
    return [];
  }

  const matches: SecretMatch[] = [];

  for (const rule of VALUE_RULES) {
    for (const match of text.matchAll(rule.regex)) {
      const start = match.index ?? 0;
      const kept = rule.render
        ? match[0].length
        : keptLengthAtBoundary(match[0]);
      if (kept === 0) continue;
      matches.push({
        ruleId: rule.id,
        description: rule.description,
        start,
        end: start + kept,
      });
    }
  }

  for (const pattern of customPatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const kept = keptLengthAtBoundary(match[0]);
      if (kept === 0) continue;
      matches.push({
        ruleId: "custom_pattern",
        description: "Custom secret pattern",
        start,
        end: start + kept,
      });
    }
  }

  return matches;
}
