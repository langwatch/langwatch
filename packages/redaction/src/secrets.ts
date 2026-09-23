/** In-process credential redaction: scrubs API keys, JWTs, tokens from free text. */
import { SECRET_MARKER } from "./markers.ts";

/** The placeholder a redacted secret is replaced with. */
export const SECRETS_REDACTION_MARKER = SECRET_MARKER;
const REPLACEMENT = SECRETS_REDACTION_MARKER;

/** Inputs longer than this are passed through untouched, mirroring the PII size budget. */
const MAX_SCAN_LENGTH = 250_000;

interface ValueRule {
  id: string;
  description: string;
  regex: RegExp;
  /** Builds replacement for one match; defaults to full marker. Groups preserve context. */
  render?: (...groups: string[]) => string;
  /** Second-stage test: accepts or rejects a candidate after regex match. */
  accept?: (groups: string[]) => boolean;
  /** Cheap guard to skip scan if input cannot contain a match. */
  precondition?: (text: string) => boolean;
  /** Pattern that must precede the match but is left out of the reported span. */
  precededBy?: RegExp;
}

/** Entropy sample size: score leading chars, not full greedy match. */
const ENTROPY_SAMPLE_LENGTH = 256;

/** Shannon entropy of `value` in bits per character, over a bounded sample. */
function shannonEntropyBits(value: string): number {
  const sample =
    value.length > ENTROPY_SAMPLE_LENGTH ? value.slice(0, ENTROPY_SAMPLE_LENGTH) : value;
  const counts = new Map<string, number>();
  for (const char of sample) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / sample.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

interface CharClassCounts {
  lower: number;
  upper: number;
  digit: number;
}

function countCharClasses(value: string): CharClassCounts {
  let lower = 0;
  let upper = 0;
  let digit = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 97 && code <= 122) lower++;
    else if (code >= 65 && code <= 90) upper++;
    else if (code >= 48 && code <= 57) digit++;
  }
  return { lower, upper, digit };
}

/** Neither side of a credential token may continue into a longer identifier. */
const TOKEN_START = String.raw`(?<![A-Za-z0-9_-])`;
const TOKEN_END = String.raw`(?![A-Za-z0-9_-])`;

/**
 * Prefixes minted by developer services, alternated into one pass. Twilio's
 * bare 32-hex token matches via `TWILIO_AUTH_TOKEN=` context instead;
 * PostHog's public `phc_` key ships in bundles by design, so only `phx_` matches.
 */
const VENDOR_KEY_PATTERNS = [
  // LangWatch's own token prefixes, minted by modules/api-key/contract/src/api-key.tokens.ts.
  // The 3-body-char floor keeps a bare prefix (printed alone in docs/errors) from matching as a
  // key. Duplicated here rather than imported so this package stays dependency-free; a test pins
  // them to the constants so the two cannot drift.
  String.raw`(?:sk|ik|pat|vk)-lw-[A-Za-z0-9_-]{3,}`,
  // GitLab personal, project, deploy, runner and agent tokens.
  String.raw`gl(?:pat|rt|dt|soat|ptt|cbt|imt|agent|ffct)-[A-Za-z0-9_-]{20,}`,
  String.raw`npm_[A-Za-z0-9]{36}`,
  // Google OAuth client secret.
  String.raw`GOCSPX-[A-Za-z0-9_-]{20,}`,
  String.raw`mb_[A-Za-z0-9+/=]{40,}`,
  String.raw`dckr_pat_[A-Za-z0-9_-]{20,}`,
  // Shopify admin, storefront, custom and private app tokens.
  String.raw`shp(?:at|ss|ca|pa)_[0-9a-fA-F]{32}`,
  String.raw`SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}`,
  String.raw`hf_[A-Za-z0-9]{30,}`,
  String.raw`gsk_[A-Za-z0-9]{40,}`,
  String.raw`pplx-[A-Za-z0-9]{30,}`,
  String.raw`nvapi-[A-Za-z0-9_-]{40,}`,
  String.raw`r8_[A-Za-z0-9]{30,}`,
  String.raw`xai-[A-Za-z0-9]{40,}`,
  // Notion integration tokens, current and legacy.
  String.raw`ntn_[A-Za-z0-9]{30,}`,
  String.raw`secret_[A-Za-z0-9]{40,}`,
  String.raw`dop_v1_[0-9a-f]{64}`,
  String.raw`figd_[A-Za-z0-9_-]{30,}`,
  String.raw`ATATT[A-Za-z0-9_=-]{100,}`,
  String.raw`sq0(?:atp|csp)-[A-Za-z0-9_-]{20,}`,
  String.raw`EAAG[A-Za-z0-9]{60,}`,
  String.raw`key-[0-9a-f]{32}`,
  String.raw`re_[A-Za-z0-9_-]{20,}`,
  String.raw`phx_[A-Za-z0-9]{30,}`,
  String.raw`lin_api_[A-Za-z0-9]{30,}`,
  String.raw`sl\.[A-Za-z0-9_-]{60,}`,
  String.raw`ya29\.[A-Za-z0-9_-]{20,}`,
  String.raw`sbp_[0-9a-f]{40,}`,
  String.raw`sntry(?:s|u)_[A-Za-z0-9_.-]{30,}`,
  String.raw`fw_[A-Za-z0-9]{20,}`,
  String.raw`gl(?:c|sa)_[A-Za-z0-9]{30,}`,
  String.raw`NRAK-[A-Za-z0-9]{20,}`,
  String.raw`PMAK-[A-Za-z0-9]{20,}-[A-Za-z0-9]{20,}`,
  String.raw`dp\.(?:pt|st|ct|sa)\.[A-Za-z0-9_-]{20,}`,
  // Airtable personal access token: patXXXXXXXXXXXXXX.<64 hex>.
  String.raw`pat[A-Za-z0-9]{14}\.[0-9a-f]{64}`,
  // Telegram bot token: <numeric bot id>:AA<35-char body>.
  String.raw`[0-9]{8,10}:AA[A-Za-z0-9_-]{33}`,
] as const;

const VENDOR_KEY_REGEX = new RegExp(
  `${TOKEN_START}(?:${VENDOR_KEY_PATTERNS.join("|")})${TOKEN_END}`,
  "g",
);

/**
 * Bounds for the shape-only rule. The floor keeps short identifiers out; the
 * ceiling keeps a long encoded payload (an embedded image, a serialised blob)
 * from being swallowed whole, since no credential is that long.
 */
const SHAPED_TOKEN_MIN_BODY = 26;
const SHAPED_TOKEN_MAX_BODY = 120;
const SHAPED_TOKEN_MIN_ENTROPY = 3.9;

/**
 * Two chars of each class (upper/lower/digit) separates random bytes from
 * SHAs and camelCase identifiers. Base64's `+`/`/` are included too: excluding
 * them missed AWS secret keys and halved recall on base64 bodies.
 */
function isKeyShapedBody(body: string): boolean {
  if (body.length < SHAPED_TOKEN_MIN_BODY || body.length > SHAPED_TOKEN_MAX_BODY) {
    return false;
  }
  const { lower, upper, digit } = countCharClasses(body);
  if (lower < 2 || upper < 2 || digit < 2) return false;
  return shannonEntropyBits(body) >= SHAPED_TOKEN_MIN_ENTROPY;
}

/**
 * Digest/encoding prefixes, not vendors. A content hash has key-material
 * entropy but none of the sensitivity, so redacting `sha512-…`/`blake3-…`
 * would turn a lockfile or build-manifest diff into placeholders for no gain.
 */
const DIGEST_PREFIXES = new Set([
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
  "sha3",
  "md4",
  "md5",
  "blake2b",
  "blake2s",
  "blake3",
  "crc32",
  "xxh3",
  "xxh64",
  "base32",
  "base58",
  "base64",
  "hex",
  "uuid",
  "urn",
  "cid",
  "etag",
  "hash",
  "digest",
  "checksum",
  "integrity",
]);

/**
 * The middle word that turns a prefixed hex string into a credential — an
 * all-hex body is more often a commit or trace id than a key, so `live`/`key`/
 * `secret` is what separates `acme_live_<hex>` from `commit_<hex>`.
 */
const HEX_BODY_CREDENTIAL_SEGMENTS = [
  "live",
  "test",
  "prod",
  "sk",
  "pk",
  "key",
  "secret",
  "token",
] as const;

/**
 * Prefixes that name an identifier, checked even though a credential segment is
 * already required. `commit_key_…` and `trace_token_…` are not credentials, and
 * a rule that eats a trace id destroys the thing the product exists to show.
 */
const IDENTIFIER_PREFIXES = new Set([
  "commit",
  "sha",
  "sha1",
  "sha256",
  "md5",
  "hash",
  "digest",
  "trace",
  "span",
  "id",
  "uuid",
  "rev",
  "blob",
  "tree",
  "etag",
  "checksum",
]);

/**
 * Prefixes that name a RECORD, not a key — same shape/entropy as one, so it
 * must be named explicitly. Redaction is irreversible at ingestion, so eating
 * an id is worse than missing a key.
 */
const RECORD_ID_PREFIXES = new Set([
  "project",
  "provider",
  "card",
  "eval",
  "monitor",
  "scenario",
  "ses",
  "sess",
  "session",
  "thread",
  "conv",
  "langyconv",
  "span",
  "trace",
  "run",
  "msg",
  "task",
  "job",
  "step",
  "node",
  "team",
  "org",
  "user",
  "call",
  "req",
  "resp",
  "chatcmpl",
  "toolu",
  "asst",
  "file",
  "batch",
  "evt",
  "acct",
  "cus",
  "sub",
]);

/**
 * Keys published on purpose. PostHog's `phc_` ships in bundles by design, so
 * blanking it protects nothing — the shape rule caught it anyway, the same
 * over-redaction as eating a record id.
 */
const PUBLIC_KEY_PREFIXES = new Set(["phc"]);

/** Every prefix that announces something other than a credential. */
function isNonCredentialPrefix(prefix: string): boolean {
  const lower = prefix.toLowerCase();
  return (
    DIGEST_PREFIXES.has(lower) ||
    IDENTIFIER_PREFIXES.has(lower) ||
    RECORD_ID_PREFIXES.has(lower) ||
    PUBLIC_KEY_PREFIXES.has(lower)
  );
}

/**
 * Floor and ceiling for the hex body. The floor is well above a short id; the
 * ceiling keeps a long encoded blob from being swallowed whole.
 */
const HEX_BODY_MIN = 24;
const HEX_BODY_MAX = 128;

/**
 * Words that stand in for a credential in documentation and templates. The
 * trailing class is a flat `*` rather than a repeated group, so a long
 * non-matching value costs one linear scan instead of backtracking.
 */
const PLACEHOLDER_VALUE_REGEX =
  /^(?:x+|\*+|\.+|-+|_+|0+|(?:your|my|our|insert|replace|example|sample|dummy|fake|placeholder|changeme|redacted|removed|hidden|none|null|nil|undefined|todo|tbd|fixme)[a-z0-9_\- ]*)$/i;

/**
 * A reference to a credential rather than the credential: an explicit `$VAR`,
 * or a SCREAMING_SNAKE name. The underscore is required on the bare form so an
 * all-uppercase secret (a base32 TOTP seed, say) is not mistaken for a name.
 */
const ENV_REFERENCE_REGEX = /^(?:\$[A-Za-z_][A-Za-z0-9_]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;

/** `process.env.OPENAI_API_KEY`, `config.auth.token`: code, not key material. */
const CODE_EXPRESSION_REGEX = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/** A filesystem path, which follows a credential keyword often enough to matter. */
const PATH_LIKE_REGEX = /^[~.]{0,2}\/|\/[^/\s]*\.[a-z]{1,5}$/;

const CONTEXT_VALUE_MIN_LENGTH = 16;
const CONTEXT_VALUE_MIN_ENTROPY = 2.9;

/**
 * Does a value already introduced by a keyword carry a credential? Looser
 * than the shape-only rule, but rejects what commonly follows a keyword and
 * isn't one: a placeholder, an env-var reference, a URL.
 */
function isCredentialValue(value: string): boolean {
  if (value.length < CONTEXT_VALUE_MIN_LENGTH) return false;
  if (PLACEHOLDER_VALUE_REGEX.test(value)) return false;
  if (ENV_REFERENCE_REGEX.test(value)) return false;
  if (CODE_EXPRESSION_REGEX.test(value)) return false;
  if (PATH_LIKE_REGEX.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (value.includes(SECRETS_REDACTION_MARKER)) return false;
  return shannonEntropyBits(value) >= CONTEXT_VALUE_MIN_ENTROPY;
}

/** A dotted or dashed version string, which follows a keyword often enough. */
const VERSION_STRING_REGEX = /^v?\d+(?:[._-]\d+)+/;

const LOOSE_VALUE_MIN_LENGTH = 20;
const LOOSE_VALUE_MIN_ENTROPY = 3.4;

/**
 * The bar when the separator was only whitespace (`key <value>` vs `key:
 * <value>`): must look like key material, which cut false positives from
 * 5,816 spans to 338, ~87% precision.
 */
function isKeyMaterial(value: string): boolean {
  if (value.length < LOOSE_VALUE_MIN_LENGTH) return false;
  if (!isCredentialValue(value)) return false;
  if (VERSION_STRING_REGEX.test(value)) return false;
  if (shannonEntropyBits(value) < LOOSE_VALUE_MIN_ENTROPY) return false;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  if (/^[A-Z2-7]{32,}={0,6}$/.test(value)) return true;
  const { lower, upper, digit } = countCharClasses(value);
  return digit >= 2 && (lower >= 2 || upper >= 2);
}

/**
 * Words that turn a bare `key` into a credential. Shared by the name rule and
 * the free-text cue below so the two cannot drift — an unqualified `key` alone
 * is not proof of a credential; it as often names an ordinary map entry.
 */
const CREDENTIAL_QUALIFIERS = new Set([
  "master",
  "encryption",
  "signing",
  "private",
  "access",
  "api",
  "auth",
  "secret",
  "refresh",
  "session",
  "bearer",
  "verification",
  "webhook",
  "client",
  "service",
  "personal",
  "root",
  "admin",
]);

const QUALIFIER_ALTERNATION = [...CREDENTIAL_QUALIFIERS].join("|");

/**
 * Words that introduce a credential, incl. compound spellings (`api key`,
 * `x-api-key`). `key` alone needs a qualifier — unqualified, it names an
 * ordinary map entry in JSON/OTLP/config dictionaries at least as often.
 */
const CREDENTIAL_KEYWORD =
  String.raw`(?:x[_.\- ]?)?(?:` +
  String.raw`(?:${QUALIFIER_ALTERNATION})[_.\- ]?(?:api[_.\- ]?)?key` +
  String.raw`|(?:${QUALIFIER_ALTERNATION})?[_.\- ]?(?:api[_.\- ]?)?` +
  String.raw`(?:token|secret|password|passwd|pwd|credentials?|authorization|cookie)` +
  String.raw`)`;

/**
 * A base64 payload after `Basic `, as opposed to the English word that follows
 * "Basic" in a sentence about basic authentication.
 */
function isBasicAuthPayload(value: string): boolean {
  if (value.endsWith("=")) return true;
  const { lower, upper, digit } = countCharClasses(value);
  return digit > 0 || (lower > 0 && upper > 0);
}

/**
 * Built-in value patterns, matched only via `.replace` (never `.test`/`.exec`,
 * which carry `lastIndex` on a global regex). Order matters: precise vendor
 * rules run before the broad shape/context ones, so a match reports under its vendor.
 */
const VALUE_RULES: ValueRule[] = [
  {
    id: "pem_private_key",
    description: "PEM private key block",
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    // PuTTY's own private-key format, which carries no PEM armour. The body
    // runs to the end of the file, so it is clamped at the next blank line
    // rather than allowed to swallow the rest of the payload.
    id: "putty_private_key",
    description: "PuTTY private key file",
    regex: /PuTTY-User-Key-File-\d+:[\s\S]*?(?:\n\s*\n|$)/g,
  },
  {
    // A kubeconfig embeds the client certificate and its key as base64. The
    // key is the credential; the certificate is redacted with it because
    // together they are a working login.
    id: "kubeconfig_client_credentials",
    description: "Embedded kubeconfig client key or certificate",
    regex: /\b(client-(?:key|certificate)-data:\s*)[A-Za-z0-9+/=]{40,}/g,
    render: (_m, prefix) => `${prefix}${REPLACEMENT}`,
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
    id: "vendor_api_key",
    description:
      "Developer-service API key (GitLab, npm, Docker Hub, Shopify, SendGrid, Hugging Face, Groq, Notion, Atlassian and others)",
    regex: VENDOR_KEY_REGEX,
  },
  {
    id: "jwt",
    description: "JSON Web Token",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "url_credentials",
    description: "Password embedded in a connection URL",
    // scheme://user:password@host -> keep everything but the password. The scheme sits in a
    // lookbehind so the engine anchors on the literal `:` instead of scanning from every
    // lowercase letter: unanchored this cost 6.2ms on a 200KB payload (more than every other
    // rule combined); anchored, 0.09ms. The scheme stays outside the match and untouched.
    regex: /(?<=[a-z][a-z0-9+.-]{0,30})(:\/\/[^\s:@/]+:)([^\s:@/]+)(@)/gi,
    // The same scheme the lookbehind reads, so a reported match still spans the
    // whole URL rather than starting at the colon.
    precededBy: /[a-z][a-z0-9+.-]{0,30}$/i,
    render: (_m, prefix, _password, at) => `${prefix}${REPLACEMENT}${at}`,
  },
  {
    id: "bearer_token",
    description: "Bearer authorization token",
    regex: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{10,}=*/gi,
    render: (_m, prefix) => `${prefix}${REPLACEMENT}`,
  },
  {
    // The other Authorization schemes. Unlike `Bearer` these are ordinary
    // words (`Token`, `OAuth`, `Splunk`), so they are only a credential cue
    // inside an actual Authorization header: a bare "token acme_live_abcd1234"
    // in prose is a sentence, not a header, and matching it redacted one.
    id: "authorization_scheme_token",
    description: "Non-Bearer authorization scheme token",
    regex: /\b(Authorization:\s*(?:Token|SSWS|GenieKey|Splunk|OAuth)\s+)[A-Za-z0-9._~+/-]{10,}=*/gi,
    render: (_m, prefix) => `${prefix}${REPLACEMENT}`,
  },
  {
    id: "basic_auth_credentials",
    description: "Basic authorization credentials",
    regex: /\b(Basic\s+)([A-Za-z0-9+/]{16,}={0,2})(?![A-Za-z0-9+/=])/g,
    accept: (groups) => isBasicAuthPayload(groups[2] ?? ""),
    render: (_m, prefix) => `${prefix}${REPLACEMENT}`,
  },
  {
    // The all-hex sibling of the shape rule below, which cannot accept a hex
    // body without also accepting every digest and trace id in the transcript.
    // A credential segment in the middle of the token is what makes the
    // difference, so this rule requires one and refuses identifier prefixes on
    // top of it.
    id: "prefixed_hex_api_key",
    description: "API key with a vendor prefix and an all-hex body",
    regex: new RegExp(
      `${TOKEN_START}([A-Za-z][A-Za-z0-9]{1,11})_(?:${HEX_BODY_CREDENTIAL_SEGMENTS.join("|")})_` +
        `([0-9a-f]{${HEX_BODY_MIN},${HEX_BODY_MAX}})${TOKEN_END}`,
      "gi",
    ),
    accept: (groups) => !IDENTIFIER_PREFIXES.has((groups[1] ?? "").toLowerCase()),
    precondition: (text) => text.includes("_"),
  },
  {
    // The layer that catches a vendor nobody has heard of: a short prefix, a separator and a
    // high-entropy body, needing no vendor knowledge. The prefix may be upper, lower or mixed
    // case since plenty of vendors mint `LW_…` or `Xy_…`; that also makes it the shape of a
    // screaming-snake env var NAME, but the length floor and character-mix gate turn those away.

    // A declined match consumes the text it spanned, so in principle an outer match could hide
    // secret material further inside the same token. It cannot in practice: a body containing
    // key material inherits that material's entropy and mix, so the outer match is accepted and
    // the secret is redacted along with its prefix.
    id: "shaped_api_key",
    description: "High-entropy API key with a vendor-style prefix",
    regex: new RegExp(
      `${TOKEN_START}([A-Za-z][A-Za-z0-9]{1,11})[_-]([A-Za-z0-9_+/-]{${SHAPED_TOKEN_MIN_BODY},})${TOKEN_END}`,
      "g",
    ),
    accept: (groups) => !isNonCredentialPrefix(groups[1] ?? "") && isKeyShapedBody(groups[2] ?? ""),
    precondition: (text) => text.includes("_") || text.includes("-"),
  },
  {
    // The layer that needs no shape at all: the text says what the value is.
    // Up to two filler words are tolerated between the keyword and the
    // separator, because people write "key now:" and "token here =" as often as
    // they write "key:".
    id: "sensitive_assignment",
    description: "Value assigned to a credential-named field",
    // `key is <value>` was rejected as a strict separator: on real traces it caught zero
    // credentials while being the sole source of prose false-positives. Whitespace is accepted
    // instead on a higher bar — the value must look like key material (see `isKeyMaterial`) —
    // which is what keeps `Authorization <token>` and `key <token>` while rejecting prose.

    // The value class excludes backslash: span content arrives JSON-encoded, so a literal `\n`
    // is two characters, and letting a value run through one carried it across logical lines and
    // past the `$VAR`/code-expression guards — `api_key = $OPENAI_API_KEY` was kept with a real
    // newline and redacted with an escaped one.
    regex: new RegExp(
      `((?:^|[\\W_])(?:${CREDENTIAL_KEYWORD})(?:\\s+[A-Za-z]{1,8}){0,2}["'\`]?` +
        `(?:\\s*[:=]{1,2}\\s*|[ \\t?-]+)["'\`]?)` +
        `([^\\s"'\`,;<>(){}\\[\\]\\\\]{${CONTEXT_VALUE_MIN_LENGTH},})`,
      "gi",
    ),
    accept: (groups) => {
      const introduction = groups[1] ?? "";
      const value = groups[2] ?? "";
      const strict = /[:=]\s*["'`]?$/.test(introduction);
      return strict ? isCredentialValue(value) : isKeyMaterial(value);
    },
    render: (_m, introduction) => `${introduction}${REPLACEMENT}`,
  },
];

/** Public catalog of the built-in value rules, for UI chips and docs. */
export const BUILTIN_SECRET_RULES: readonly {
  id: string;
  description: string;
}[] = VALUE_RULES.map(({ id, description }) => ({ id, description }));

/**
 * Rules that judge a token by SHAPE alone — the only ones that can take an
 * identifier (this took `scenario.run_id` in production) and the only ones a
 * caller has cause to turn off.
 */
export const SHAPE_ONLY_SECRET_RULE_IDS: readonly string[] = [
  "prefixed_hex_api_key",
  "shaped_api_key",
];

/**
 * Attribute names whose VALUE should always be scrubbed regardless of shape.
 * Non-global (so `.test` is safe) and bounded by `._-` separators so plural or
 * compound metadata keys like `gen_ai.usage.input_tokens` never match `token`.
 */
const SENSITIVE_KEY_REGEX =
  /(?:^|[._-])(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|authorization|auth|bearer|credentials?|private[_-]?key|client[_-]?secret|db[_-]?password|connection[_-]?string|session[_-]?token|refresh[_-]?token|set[_-]?cookie|cookie|x-api-key)(?:$|[._-])/i;

/**
 * Nouns that name a credential on their own, whatever sits beside them.
 * `key` and `token` are deliberately absent: bare, they are far more often an
 * `idempotency_key`, a `partition_key` or a count of `input_tokens`.
 */
const CREDENTIAL_NOUNS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "authorization",
  "auth",
  "bearer",
  "credential",
  "credentials",
  "cookie",
]);

/**
 * Split an attribute name into words, on separators AND CamelCase boundaries: a separator-only
 * split is blind to camelCase/PascalCase names like `signingSecret`, `bearerToken` or AWS's own
 * `SecretString`, which read as one opaque word and never fire.
 */
function tokenizeAttributeName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

/** Does this name say, in any of its words, that it holds a credential? */
function namesACredential(name: string): boolean {
  const tokens = tokenizeAttributeName(name);
  return tokens.some((token, index) => {
    if (CREDENTIAL_NOUNS.has(token)) return true;
    if (token !== "key" && token !== "token") return false;
    const previous = tokens[index - 1];
    return previous !== undefined && CREDENTIAL_QUALIFIERS.has(previous);
  });
}

export function isSensitiveAttributeKey(key: string): boolean {
  return SENSITIVE_KEY_REGEX.test(key) || namesACredential(key);
}

/**
 * A pattern that states where it may start is compiled as-is. The lookbehind
 * arm must be `(?<=`/`(?<!`, never bare `(?<` — a named capture group opens
 * the same way, and a looser test once shredded `task-notification`.
 */
const SELF_ANCHORED_PATTERN = /^(?:\^|\\b|\\B|\(\?<[=!])/;

/**
 * Gives a hand-written pattern the word boundary it almost certainly meant:
 * `sk-.*` also matches the `sk-` inside `task-notification`. The wrapping
 * group is non-capturing, so the author's own groups keep their numbers.
 */
function guardCustomPattern(pattern: string): string {
  if (SELF_ANCHORED_PATTERN.test(pattern)) return pattern;
  return `(?<![A-Za-z0-9_])(?:${pattern})`;
}

/**
 * Strings carrying no credential: agent prose, a transcript tag, a source
 * path, a timestamp, a model name. Matching one destroys trace content
 * irreversibly instead of protecting it — a customer has lost a tag this way.
 */
const ORDINARY_TEXT_PROBES = [
  "the user asked the agent to summarise the meeting notes",
  "<task-notification>",
  "modules/trace/process/src/services/trace-legacy-read.service.ts",
  "2026-08-10T14:32:11.482Z",
  "claude-opus-5",
  // The identifiers a tracing product is made of. Without these a pattern like
  // `[0-9a-f]{6,}` reads as credential-shaped and is accepted, then redacts
  // every commit hash, trace id and UUID in the transcript. They are the most
  // expensive thing a broad pattern can eat here, so they are probed for.
  "fix in commit 51d07b547d0a8f3e2c1b9d4a6e7f8091a2b3c4d5",
  "id 550e8400-e29b-41d4-a716-446655440000 done",
  "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
] as const;

/**
 * The first ordinary-text probe a custom pattern would eat, or `null` if it
 * only matches credential-shaped strings — warns when the pattern is written,
 * not weeks later from a corrupted transcript. Uses the exact ingestion guard.
 */
export function overBroadSecretPatternProbe(pattern: string): string | null {
  // A blank pattern is an empty row the customer has not finished typing, not a
  // pattern that eats everything. Guarded it compiles to `(?<![A-Za-z0-9_])(?:)`,
  // which matches at index 0 of every probe, so without this the settings page
  // reports "also matches ordinary text" the instant a row is added. Handled
  // here rather than in each caller so a future caller inherits it.
  if (pattern.trim() === "") return null;
  let probeRegex: RegExp;
  try {
    // Deliberately not global: `.test` on a global regex carries `lastIndex`
    // between calls and would skip probes.
    probeRegex = new RegExp(guardCustomPattern(pattern), "i");
  } catch {
    // An uncompilable pattern is reported by the caller's own compile check.
    return null;
  }
  return ORDINARY_TEXT_PROBES.find((probe) => probeRegex.test(probe)) ?? null;
}

/**
 * Compiles user pattern strings into case-insensitive global regexes, silently
 * dropping any that fail (a last-resort guard; the service already validates
 * with `isSafeRegex`). Each gets a leading word boundary unless it has one.
 */
export function compileSecretPatterns(patterns: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    const guarded = findGuardedPattern(pattern);
    if (guarded) compiled.push(guarded);
  }
  return compiled;
}

/**
 * One custom pattern, guarded, or undefined when it does not compile — the
 * service checks them with `isSafeRegex` before they are stored, so an
 * uncompilable one is skipped rather than thrown in the hot path.
 */
function findGuardedPattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(guardCustomPattern(pattern), "gi");
  } catch {
    return void 0;
  }
}

/**
 * A secret value can never contain a quote or backtick, so clamping at the
 * first one stops a greedy pattern like `sk-.*` from eating the rest of the
 * line. Newlines are excluded — the multi-line PEM rule must keep spanning them.
 */
const VALUE_BOUNDARY = /["'`]/;

/** Length of `match` up to the first structural boundary char (or its full length). */
function keptLengthAtBoundary(match: string): number {
  const index = match.search(VALUE_BOUNDARY);
  return index === -1 ? match.length : index;
}

/**
 * The same clamp, widened to whitespace and angle brackets: a trailing `.*`
 * in a custom pattern otherwise runs to the end of the line, taking the rest
 * of the log line or XML tag with it. A credential never contains either.
 */
const CUSTOM_VALUE_BOUNDARY = /[\s"'`<>]/;

function keptLengthForCustomPattern(match: string): number {
  const index = match.search(CUSTOM_VALUE_BOUNDARY);
  return index === -1 ? match.length : index;
}

export interface SecretsRedactionResult {
  text: string;
  redactedCount: number;
}

/**
 * What one matched rule leaves behind, or `null` to decline and restore the
 * original text. Context-preserving rules (url password, bearer prefix) skip
 * the clamp below — they're already tightly bounded, so nothing else needed.
 */
function replacementFor(rule: ValueRule, args: string[]): string | null {
  const full = args[0] ?? "";
  if (rule.accept && !rule.accept(args)) return null;
  if (rule.render) return rule.render(...args);
  const kept = keptLengthAtBoundary(full);
  if (kept === 0) return null;
  return REPLACEMENT + full.slice(kept);
}

/**
 * Cuts oversized text into pieces on a newline boundary, so a credential isn't
 * split mid-token. Returning long text untouched was a hard bypass, not a
 * budget: an 885 KB input carrying a live key once went through unscanned.
 */
function sliceForScan(text: string): string[] {
  if (text.length <= MAX_SCAN_LENGTH) return [text];
  const slices: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = sliceEndAfter(text, start);
    slices.push(text.slice(start, end));
    start = end;
  }
  return slices;
}

/**
 * Where a slice may end WITHOUT splitting a credential — every cut lands on
 * whitespace, since a mid-token split matches no rule on either half. A PEM
 * block is the exception: an unterminated `-----BEGIN` pulls its `-----END` in.
 */
function sliceEndAfter(text: string, start: number): number {
  const target = Math.min(start + MAX_SCAN_LENGTH, text.length);
  if (target >= text.length) return text.length;

  let end: number;
  const lastSpace = text.slice(start, target).search(/\s(?=\S*$)/);
  if (lastSpace > 0) {
    end = start + lastSpace;
  } else {
    // The whole window is one unbroken run; look ahead for whitespace but cap
    // it — past this the run is far longer than any credential, so cutting
    // inside it cannot split one, and an unbounded payload can't skip scanning.
    const lookahead = text.slice(target, target + SAFE_CUT_LOOKAHEAD);
    const next = lookahead.search(/\s/);
    end = next === -1 ? Math.min(target + SAFE_CUT_LOOKAHEAD, text.length) : target + next;
  }

  const begin = text.lastIndexOf(PEM_BEGIN, end);
  const close = text.indexOf(PEM_END, begin);
  // `close >= end` implies the block opened inside this slice and closes past
  // its end, so the cut moves out to take the whole block. A missing END gives
  // -1, which fails that same test, so an unterminated block is left alone.
  if (begin >= start && close >= end) {
    end = close + PEM_END.length;
  }
  return end;
}

/**
 * How far past the budget a cut may hunt for whitespace. Comfortably longer
 * than any credential this file matches, so a run that outlasts it can be cut
 * without splitting one.
 */
const SAFE_CUT_LOOKAHEAD = 4_096;

const PEM_BEGIN = "-----BEGIN";
const PEM_END = "-----END";

/**
 * Redacts secrets from one string: built-in rules, then any custom patterns.
 * `skipRuleIds` reaches only the built-ins — a custom pattern is the
 * customer's own decision and always runs. See {@link SHAPE_ONLY_SECRET_RULE_IDS}.
 */
export function redactSecretsInText({
  text,
  customPatterns = [],
  skipRuleIds,
}: {
  text: string;
  customPatterns?: readonly RegExp[];
  skipRuleIds?: readonly string[];
}): SecretsRedactionResult {
  if (typeof text !== "string" || text.length === 0) {
    return { text, redactedCount: 0 };
  }
  const skipped = toSkipSet(skipRuleIds);
  if (text.length > MAX_SCAN_LENGTH) {
    let total = 0;
    const pieces = sliceForScan(text).map((slice) => {
      const scanned = redactOneSlice(slice, customPatterns, skipped);
      total += scanned.redactedCount;
      return scanned.text;
    });
    return { text: pieces.join(""), redactedCount: total };
  }
  return redactOneSlice(text, customPatterns, skipped);
}

/**
 * The skip list as a set, built once per scan rather than once per rule. An
 * absent or empty list becomes `null`, which the rule loop reads as "run
 * everything" without a lookup per rule.
 */
function toSkipSet(skipRuleIds: readonly string[] | undefined): ReadonlySet<string> | null {
  if (!skipRuleIds || skipRuleIds.length === 0) return null;
  return new Set(skipRuleIds);
}

function redactOneSlice(
  text: string,
  customPatterns: readonly RegExp[],
  skipped: ReadonlySet<string> | null,
): SecretsRedactionResult {
  let redactedCount = 0;
  let result = text;

  for (const rule of VALUE_RULES) {
    if (skipped?.has(rule.id)) continue;
    if (rule.precondition && !rule.precondition(result)) continue;
    result = result.replace(rule.regex, (...args: string[]) => {
      const replacement = replacementFor(rule, args);
      if (replacement === null) return args[0] ?? "";
      redactedCount++;
      return replacement;
    });
  }

  for (const pattern of customPatterns) {
    result = result.replace(pattern, (...args: string[]) => {
      const full = args[0] ?? "";
      const kept = keptLengthForCustomPattern(full);
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
 * Detects secrets WITHOUT redacting: returns which rule matched and where, so
 * an evaluator can report a leak. Shares the exact rule set with
 * `redactSecretsInText`; overlapping matches for one credential collapse to one.
 */
export function detectSecretsInText({
  text,
  customPatterns = [],
  skipRuleIds,
}: {
  text: string;
  customPatterns?: readonly RegExp[];
  skipRuleIds?: readonly string[];
}): SecretMatch[] {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_SCAN_LENGTH) {
    return [];
  }

  const skipped = toSkipSet(skipRuleIds);
  const matches: SecretMatch[] = [];
  for (const rule of VALUE_RULES) {
    if (skipped?.has(rule.id)) continue;
    matches.push(...matchesOfRule(rule, text));
  }
  for (const pattern of customPatterns) {
    matches.push(...matchesOfCustomPattern(pattern, text));
  }
  return withoutOverlaps(matches);
}

/** Every span one built-in rule claims in `text`, after its own accept test. */
function matchesOfRule(rule: ValueRule, text: string): SecretMatch[] {
  if (rule.precondition && !rule.precondition(text)) return [];
  const found: SecretMatch[] = [];
  for (const match of text.matchAll(rule.regex)) {
    if (ruleDeclines(rule, match)) continue;
    const kept = claimedLength(rule, match);
    if (kept === 0) continue;
    const matchStart = match.index ?? 0;
    found.push({
      ruleId: rule.id,
      description: rule.description,
      start: matchStart - lengthPrecedingMatch({ rule, text, matchStart }),
      end: matchStart + kept,
    });
  }
  return found;
}

/**
 * How much of the credential sits in front of the match, for a rule that reads
 * part of it in a lookbehind. Zero for every rule whose match covers all of it.
 */
function lengthPrecedingMatch({
  rule,
  text,
  matchStart,
}: {
  rule: ValueRule;
  text: string;
  matchStart: number;
}): number {
  if (!rule.precededBy) return 0;
  return rule.precededBy.exec(text.slice(0, matchStart))?.[0].length ?? 0;
}

/** Whether a rule's second-stage test rejects this candidate. */
function ruleDeclines(rule: ValueRule, match: RegExpMatchArray): boolean {
  return rule.accept !== undefined && !rule.accept(match);
}

/** How much of a match the rule claims: all of it, or up to the value boundary. */
function claimedLength(rule: ValueRule, match: RegExpMatchArray): number {
  return rule.render ? match[0].length : keptLengthAtBoundary(match[0]);
}

/** Every span one caller-supplied pattern claims in `text`. */
function matchesOfCustomPattern(pattern: RegExp, text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const kept = keptLengthForCustomPattern(match[0]);
    if (kept === 0) continue;
    found.push({
      ruleId: "custom_pattern",
      description: "Custom secret pattern",
      start,
      end: start + kept,
    });
  }
  return found;
}

/**
 * Collapses matches covering the same credential — layers overlap by design,
 * so the evaluator would triple-count one leak without this. Most-specific
 * rule wins over the generic shape and surrounding context.
 */
function withoutOverlaps(matches: SecretMatch[]): SecretMatch[] {
  const kept: SecretMatch[] = [];
  for (const match of matches) {
    const overlaps = kept.some((other) => match.start < other.end && other.start < match.end);
    if (!overlaps) kept.push(match);
  }
  return kept.toSorted((a, b) => a.start - b.start);
}
