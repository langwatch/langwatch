/**
 * Native, lightweight secrets redaction.
 *
 * Scrubs credentials (cloud + provider API keys, JWTs, private-key blocks,
 * database-URL passwords, bearer tokens) out of free text, plus a key-name pass
 * for obviously-sensitive attribute names. Runs in-process: no external
 * service, all patterns precompiled and linear-time. Detected secrets are
 * replaced with the typed `[SECRET]` marker, which the trace view reads back
 * and which keeps the secrets evaluator able to flag a credential that was
 * already scrubbed at ingestion.
 *
 * Matching works in three layers, because a list of known vendors alone cannot
 * keep up with the number of services that mint API keys:
 *
 *  1. Known shapes. Exact prefixes for cloud and developer-service credentials,
 *     the highest-precision layer and the one that names the vendor.
 *  2. Shape alone. A vendor-style prefix followed by a high-entropy body catches
 *     a key from a service nobody has ever added to the list.
 *  3. Context. A credential named in prose and then given a value is redacted
 *     even when the value has no recognisable shape at all.
 *
 * Layers 2 and 3 are gated on Shannon entropy and character-class mix, because
 * over-redaction is a bug of the same severity as a leak: the terminal replay
 * and the trace explorer are worth nothing if identifiers, hashes and model
 * names come back as placeholders. `__tests__/secrets.unit.test.ts` carries an
 * adversarial negative corpus that pins that limit.
 *
 * Shared across the platform: the ingestion pipeline redacts every span with
 * these rules, and the `langwatch` CLI ships a verbatim mirror (see
 * `sessionReport.ts`) so issue reports are scrubbed with the exact same rules
 * before leaving the user's machine.
 */
import { SECRET_MARKER } from "./markers.js";

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
  /**
   * Second-stage test for rules whose regex is deliberately loose, taking the
   * match and its capture groups. A match that fails it is left verbatim and
   * not counted, which is what lets the entropy and context rules describe a
   * broad shape in the pattern and then decide on the candidate itself.
   */
  accept?: (groups: string[]) => boolean;
  /**
   * Cheap whole-string guard run before the regex. Skips the scan entirely when
   * the input cannot contain a match, which keeps the broad rules off the bill
   * for the many strings that are ordinary prose.
   */
  precondition?: (text: string) => boolean;
  /**
   * Text the rule requires in front of the match but leaves out of it, written
   * to end at the match. A rule anchors on its own literal for speed and reads
   * what precedes it in a lookbehind; the credential still begins where that
   * lookbehind begins, so the reported span has to start there too. Applied to
   * the text before the match, and only by the detection path: redaction never
   * rewrites what the match does not cover.
   */
  precededBy?: RegExp;
}

/**
 * Entropy is measured over at most this many leading characters. A greedy match
 * can span a whole log line, and scoring the sample rather than the line keeps
 * the cost per candidate constant without changing the verdict: key material is
 * uniformly random, so its first 256 characters score like all of it.
 */
const ENTROPY_SAMPLE_LENGTH = 256;

/** Shannon entropy of `value` in bits per character, over a bounded sample. */
function shannonEntropyBits(value: string): number {
  const sample =
    value.length > ENTROPY_SAMPLE_LENGTH
      ? value.slice(0, ENTROPY_SAMPLE_LENGTH)
      : value;
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
 * Prefixes minted by developer services whose keys turn up in coding-agent
 * transcripts. Kept as one alternation compiled once, so the whole known-vendor
 * layer costs a single pass rather than one pass per vendor.
 *
 * Two deliberate omissions. Twilio's `AC…` and `SK…` SIDs are public account
 * identifiers, and its actual auth token is bare 32-hex, indistinguishable from
 * an MD5 digest, so matching it on shape would redact every hash in a trace;
 * the context rule covers `TWILIO_AUTH_TOKEN=…` instead. PostHog's `phc_` is a
 * client-side project key that ships inside published web bundles by design,
 * and blanking it would hide legitimate telemetry configuration, so only the
 * personal `phx_` key is matched.
 */
const VENDOR_KEY_PATTERNS = [
  // LangWatch's own API, ingest and legacy personal-access tokens, minted as
  // `{prefix}{lookupId}_{secret}` by
  // platform/app/src/server/api-key/api-key-token.utils.ts. Matched on the
  // prefix plus three body characters, like every other known vendor, so a
  // truncated or short-bodied one still redacts: `sk-lw-` would otherwise reach
  // only the generic `sk-` rule and its 20-character floor, and `ik-lw-`
  // nothing at all. The three-character floor is what keeps the bare prefix,
  // which documentation and error messages print on its own, from reading as a
  // key.
  // The prefixes are duplicated rather than imported because this package is
  // shared with the SDK and stays dependency-free; a test pins them to the
  // constants so the two cannot drift.
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
 * Does this token body look like key material rather than an identifier?
 *
 * Requiring two characters of each class is what separates a random body from
 * the things that surround it in a trace: a git SHA and a lowercase UUID carry
 * no uppercase, a screaming-snake-case constant carries no lowercase, and a
 * camelCase identifier carries no digits. A genuinely random base64url body of
 * this length clears all three with room to spare.
 *
 * The body class accepts standard base64 (`+` and `/`) as well as base64url.
 * Without it a `+` or `/` landing early in the body cut the match short of the
 * length floor and the key was missed: measured at a 57% miss rate for
 * standard-base64 bodies against 0.5% for base64url, and 100% for an AWS
 * secret access key, which is 40 characters of standard base64. Adding the two
 * characters was measured on a real trace corpus at 232 further matches and no
 * new false positives, and it needs no vendor to be named.
 */
function isKeyShapedBody(body: string): boolean {
  if (
    body.length < SHAPED_TOKEN_MIN_BODY ||
    body.length > SHAPED_TOKEN_MAX_BODY
  ) {
    return false;
  }
  const { lower, upper, digit } = countCharClasses(body);
  if (lower < 2 || upper < 2 || digit < 2) return false;
  return shannonEntropyBits(body) >= SHAPED_TOKEN_MIN_ENTROPY;
}

/**
 * Prefixes that announce a digest or an encoding rather than a vendor. A
 * content hash has exactly the entropy of key material and none of the
 * sensitivity, and it is written in the same `prefix-body` form: `sha512-…` in
 * a lockfile, `blake3-…` in a build manifest. Redacting those would turn a
 * dependency diff into placeholders for no gain.
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
 * The middle segment that turns a prefixed hex string into a credential.
 *
 * An all-hex body carries no uppercase and no symbols, so the character-mix gate
 * on the shape rule turns it away, and it must: in a tracing product a bare hex
 * run is far more likely to be a commit, a trace id or a digest than a key. The
 * Stripe family (`sk_live_…`, `pk_test_…`) and everything modelled on it says so
 * in the token itself, and that middle word is the only thing separating
 * `acme_live_<32 hex>` from `commit_<40 hex>`. Nothing here fires without it.
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
 * Prefixes that name a RECORD, in this product or in the APIs it talks to.
 *
 * `prefix_<random body>` is how this product and most of its neighbours mint an
 * id, which is the same shape a key is minted in and carries the same entropy.
 * The difference is not measurable from the string, so it has to be named: a
 * sweep of real traces found the shape rule redacting `project_…`, `card_…`,
 * `scenario_…`, `langyconv_…` and OpenAI's own `chatcmpl-…`, and those are
 * attributes the product groups and attributes traces by. Redaction is
 * irreversible at ingestion, so eating an id is worse than missing a key.
 *
 * On the swept corpus this costs no recall at all: no credential in it used any
 * of these prefixes. `toolu_` is here for the same reason, having previously
 * survived only by being two characters under the length floor, which is not a
 * margin anyone should rely on.
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
 * Keys that are published on purpose. PostHog's `phc_` is a client-side project
 * key that ships inside web bundles by design, so blanking it hides legitimate
 * telemetry configuration and protects nothing. The vendor-list comment has
 * always said so; the shape rule was catching it anyway, which is the same
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
const ENV_REFERENCE_REGEX =
  /^(?:\$[A-Za-z_][A-Za-z0-9_]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;

/** `process.env.OPENAI_API_KEY`, `config.auth.token`: code, not key material. */
const CODE_EXPRESSION_REGEX = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/** A filesystem path, which follows a credential keyword often enough to matter. */
const PATH_LIKE_REGEX = /^[~.]{0,2}\/|\/[^/\s]*\.[a-z]{1,5}$/;

const CONTEXT_VALUE_MIN_LENGTH = 16;
const CONTEXT_VALUE_MIN_ENTROPY = 2.9;

/**
 * Does this value, already introduced by a word like "api key" or "password",
 * carry an actual credential?
 *
 * The keyword has done most of the work, so this stage is looser than the
 * shape-only one: it accepts bare hex and bare base32, which the shape rule
 * rejects. It rejects the three things that follow a credential keyword and are
 * not credentials: a placeholder, an environment-variable reference, and a URL.
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
 * The bar a value has to clear when the separator was only whitespace.
 *
 * `key: <value>` is a statement about the value; `key <value>` is usually a
 * sentence. Accepting the loose separator on the same terms as the strict one
 * matched 5,816 further spans across 309 distinct shapes on a real corpus, and
 * most of them were prose. Requiring the value to look like key material in its
 * own right, rather than merely following a credential word, brings that to 338
 * spans over 19 shapes at roughly 87% precision.
 *
 * "Looks like key material" is deliberately narrow: a long hex or base32 run,
 * or a mixed body carrying both digits and same-case letters. An English word
 * clears none of them.
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
 * the free-text cue below, so the two cannot drift: they disagreed once, and
 * the cue treating an unqualified `key` as proof of a credential meant a map
 * entry like `{"key":"<content hash>"}` was destroyed at ingestion while the
 * same value on its own was correctly kept.
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
 * Words that introduce a credential, allowing the compound spellings that show
 * up in prose, environment files and JSON alike (`api key`, `API_KEY`,
 * `x-api-key`, `client_secret`).
 *
 * `key` is the one noun that needs a qualifier in front of it. Every other noun
 * here names a credential on its own, but `key` names a map entry at least as
 * often as a secret, and JSON, OTLP attributes and config dictionaries are full
 * of `key` fields holding ids and hashes.
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
 * Built-in value patterns. Each regex carries the global flag and is matched
 * only through `String.prototype.replace` (never `.test`/`.exec`, which carry
 * `lastIndex` state on global regexes). Patterns use anchors/boundaries so a
 * secret-shaped substring inside a longer identifier does not fire.
 *
 * Order matters: the precise vendor rules run before the broad shape and
 * context rules, so a recognised credential is reported under the vendor that
 * minted it rather than as a generic match.
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
    // scheme://user:password@host -> keep everything but the password. The
    // scheme length is bounded (real schemes are short) so a long run of
    // name-like characters costs constant backtracking per position instead
    // of a quadratic scan on huge inputs.
    //
    // The scheme sits in a lookbehind so that the first character the engine
    // must find is the literal `:`. With the scheme inside the match the
    // pattern starts with a character class, every lowercase letter in the
    // text is a candidate start, and each one costs up to 30 characters of
    // scheme scan before it fails: 6.2 ms on a 200 KB payload, more than every
    // other rule together. Anchored on `:` the same payload costs 0.09 ms.
    // The scheme stays outside the match and therefore untouched, which is
    // what the rule already did with it.
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
    regex:
      /\b(Authorization:\s*(?:Token|SSWS|GenieKey|Splunk|OAuth)\s+)[A-Za-z0-9._~+/-]{10,}=*/gi,
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
    accept: (groups) =>
      !IDENTIFIER_PREFIXES.has((groups[1] ?? "").toLowerCase()),
    precondition: (text) => text.includes("_"),
  },
  {
    // The layer that catches a vendor nobody has heard of. A short prefix, a
    // separator and a high-entropy body is the shape almost every modern key is
    // minted in, and it needs no vendor knowledge at all.
    //
    // The prefix may be upper, lower or mixed case: plenty of vendors mint
    // `LW_…` or `Xy_…`, and restricting it to lowercase missed them. That also
    // makes the prefix the shape of a screaming-snake environment variable
    // NAME, which must survive as a bare name, and does: `AWS_SECRET_ACCESS_KEY`
    // and `DATABASE_URL_PRODUCTION` are dictionary words with no digits and no
    // lowercase, so the length floor and the character-mix gate turn them both
    // away. The digest check lowercases the prefix so `SHA512-…` is still
    // recognised as a digest.
    //
    // A declined match consumes the text it spanned, so in principle a benign
    // outer match could hide a secret further inside the same unbroken token.
    // It cannot in practice: a body containing key material inherits that
    // material's entropy and character mix, so the outer match is accepted and
    // the secret is redacted along with its prefix.
    id: "shaped_api_key",
    description: "High-entropy API key with a vendor-style prefix",
    regex: new RegExp(
      `${TOKEN_START}([A-Za-z][A-Za-z0-9]{1,11})[_-]([A-Za-z0-9_+/-]{${SHAPED_TOKEN_MIN_BODY},})${TOKEN_END}`,
      "g",
    ),
    accept: (groups) =>
      !isNonCredentialPrefix(groups[1] ?? "") &&
      isKeyShapedBody(groups[2] ?? ""),
    precondition: (text) => text.includes("_") || text.includes("-"),
  },
  {
    // The layer that needs no shape at all: the text says what the value is.
    // Up to two filler words are tolerated between the keyword and the
    // separator, because people write "key now:" and "token here =" as often as
    // they write "key:".
    id: "sensitive_assignment",
    description: "Value assigned to a credential-named field",
    // One capture for everything that introduces the value, one for the value
    // itself, so the replacement puts the sentence back and swaps only the
    // credential.
    // `key is <value>` was accepted as a separator too, and across a 236 MB
    // corpus of real traces it caught zero credentials while being the sole
    // source of English-prose redactions: "a bare digest of an API key is
    // offline-checkable" lost the words after "key is". A cue that only ever
    // fires on prose is not a cue, so the strict separator is `:` or `=`.
    //
    // A whitespace separator is accepted on a HIGHER bar instead of not at
    // all, because `Authorization <token>` and `key <token>` do carry real
    // credentials. Ungated it matched 5,816 further spans over 309 shapes,
    // mostly prose; gated on the value looking like key material in its own
    // right it matches 338 over 19 at roughly 87% precision.
    //
    // The value class excludes backslash. Span content arrives JSON-encoded,
    // so a literal two-character `\n` sits inside the text; letting a value run
    // through one carried it across logical lines and past the `$VAR` and
    // code-expression guards, which is why `api_key = $OPENAI_API_KEY` was kept
    // with a real newline and redacted with an escaped one.
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
 * The rules that judge a token by its own SHAPE.
 *
 * Every other value rule needs the text to name the credential, either with a
 * namespace the vendor really mints (`sk-`, `ghp_`, `AKIA`, `glpat-`), with
 * armour, with a URL that carries a password, with an `Authorization` scheme,
 * or with a credential keyword in front of the value. A record id carries none
 * of those, so none of those rules can take one.
 *
 * These two read the token and nothing else. `shaped_api_key` asks only whether
 * the body looks random enough, and a record id minted as `prefix_<random body>`
 * looks exactly that random: that rule is what took `scenario.run_id` in
 * production. `prefixed_hex_api_key` asks for an all-hex body behind a middle
 * word (`live`, `test`, `key`, `secret`), and those are ordinary English words
 * that any product is free to put in an id of its own, so it reads a shape too
 * rather than a name a vendor owns.
 *
 * They are therefore the only rules that can take an identifier, and the only
 * ones a caller ever has cause to turn off. Offered as a named list so a caller
 * states which layer it is turning off rather than hard-coding rule ids, and so
 * a new shape rule joins the list here instead of being forgotten at every call
 * site.
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
 * Split an attribute name into words, on separators AND on CamelCase
 * boundaries.
 *
 * The separator-only rule this backs was blind to every camelCase and
 * PascalCase name, which is most of them in a JSON payload: `signingSecret`,
 * `bearerToken`, `SecretAccessKey` and AWS Secrets Manager's own `SecretString`
 * all read as one opaque word and none of them fired.
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
 * A pattern that already states where it may start is compiled exactly as
 * written: the author has said what they meant, so nothing is added.
 *
 * The lookbehind arm is `(?<=` or `(?<!` specifically, never a bare `(?<`: a
 * named capture group opens the same way, so the looser test read
 * `(?<key>sk-.*)` as an anchor, skipped the guard, and let that pattern shred
 * `task-notification` exactly like the unguarded `sk-.*` it exists to tame.
 */
const SELF_ANCHORED_PATTERN = /^(?:\^|\\b|\\B|\(\?<[=!])/;

/**
 * Give a hand-written pattern the word boundary it almost certainly meant.
 *
 * A pattern like `sk-.*` reads as "a key starting with sk-", but as a regex it
 * also matches the `sk-` inside `task-notification`, and everything a customer
 * types is applied to every string the pipeline stores. Adding the boundary
 * makes the pattern mean what it looks like it means. The alternation is
 * wrapped too, so `a|b` gets the guard on both branches rather than on `a`
 * alone, and the group is non-capturing so the author's own groups keep their
 * numbers.
 */
function guardCustomPattern(pattern: string): string {
  if (SELF_ANCHORED_PATTERN.test(pattern)) return pattern;
  return `(?<![A-Za-z0-9_])(?:${pattern})`;
}

/**
 * Strings carrying no credential of any kind: ordinary agent prose, a
 * transcript tag, a source path, a timestamp, a model name. A custom pattern
 * that matches one of these is not describing a credential, and because a match
 * replaces text irreversibly at ingestion, such a pattern destroys trace
 * content instead of protecting it. The transcript tag is the one a customer
 * actually lost to a pattern of `sk-.*`.
 */
const ORDINARY_TEXT_PROBES = [
  "the user asked the agent to summarise the meeting notes",
  "<task-notification>",
  "platform/app/src/server/traces/trace.service.ts",
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
 * The first piece of ordinary text a custom secret pattern would eat, or `null`
 * when it only matches credential-shaped strings. Callers use this to refuse or
 * warn about a pattern at the point it is written, rather than discovering it
 * from a corrupted transcript weeks later.
 *
 * The probe is compiled through the exact guard the ingestion path applies, so
 * what this reports is what would really happen. Without that, a settings-page
 * warning and the runtime would be describing two different regexes.
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
 * Compile user-supplied pattern strings into case-insensitive global regexes,
 * silently dropping any that fail to compile (the service validates them with
 * `isSafeRegex` before they are ever stored, so this is a last-resort guard).
 * Each is given a leading word boundary unless it already carries one.
 */
export function compileSecretPatterns(patterns: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(guardCustomPattern(pattern), "gi"));
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

/**
 * The same clamp for a hand-written pattern, widened to whitespace and angle
 * brackets. A trailing `.*` is the commonest thing in a custom pattern and it
 * runs to the end of the line, so without this a single credential match takes
 * the rest of the log line, the rest of the XML tag, and the sentence after it
 * with it. A credential never contains a space or a bracket, so stopping there
 * costs nothing and bounds the blast radius of a pattern written in haste.
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
 * What one matched rule leaves behind, or `null` to decline the match and put
 * the text back exactly as it was found. A broad rule gets the final say on its
 * own candidate here; rules that keep surrounding context (url password, bearer
 * prefix) are tightly bounded already, so they render without the clamp.
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
 * Cut oversized text into scannable pieces, preferring a newline boundary so a
 * credential is not split down the middle.
 *
 * Returning long text untouched, which is what this replaced, was a hard
 * bypass rather than a budget: an 885 KB agent input carrying a live provider
 * key went through ingestion completely unscanned, and anything over the limit
 * was a reliable way to smuggle one past redaction. Slicing keeps the per-pass
 * cost bounded while leaving no unscanned region.
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
 * Where the slice starting at `start` may end WITHOUT splitting a credential.
 *
 * A boundary that lands mid-token is the same leak this slicing exists to
 * close: neither half matches any rule, so the credential passes through in two
 * readable pieces. Every cut therefore lands on whitespace, which no
 * single-line credential contains, and if the window holds no whitespace at all
 * the cut moves forward to the next one rather than falling inside the run.
 *
 * A PEM block is the exception that whitespace alone does not cover, since it
 * spans newlines by design. An unterminated `-----BEGIN` pulls its `-----END`
 * into the same slice.
 */
function sliceEndAfter(text: string, start: number): number {
  const target = Math.min(start + MAX_SCAN_LENGTH, text.length);
  if (target >= text.length) return text.length;

  let end: number;
  const lastSpace = text.slice(start, target).search(/\s(?=\S*$)/);
  if (lastSpace > 0) {
    end = start + lastSpace;
  } else {
    // The whole window is one unbroken run, so cutting at `target` would land
    // mid-token. Look ahead for the whitespace that ends the run, but only so
    // far: past this much the run is an order of magnitude longer than any
    // credential, and cutting inside it cannot split one. Without the cap a
    // payload carrying no whitespace at all would come back as a single slice,
    // which is the unbounded scan the budget exists to prevent.
    const lookahead = text.slice(target, target + SAFE_CUT_LOOKAHEAD);
    const next = lookahead.search(/\s/);
    end =
      next === -1
        ? Math.min(target + SAFE_CUT_LOOKAHEAD, text.length)
        : target + next;
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
 * Redact secrets from one string. Runs every built-in value rule, then any
 * caller-supplied custom patterns. Returns the scrubbed text and how many
 * secrets were replaced.
 *
 * `skipRuleIds` names built-in rules to leave out of this one scan. It reaches
 * the built-in rules only: a custom pattern is a decision the customer made
 * about their own data and always runs. See
 * {@link SHAPE_ONLY_SECRET_RULE_IDS} for the one list a caller has cause to
 * pass.
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
function toSkipSet(
  skipRuleIds: readonly string[] | undefined,
): ReadonlySet<string> | null {
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
 * Detect secrets in one string WITHOUT redacting it: returns the rule that
 * matched and where, so the secrets evaluator can report a leak (and which
 * kind) while leaving the text alone. Shares the exact rule set used by
 * `redactSecretsInText`, including `skipRuleIds`, so what the evaluator flags
 * is what redaction scrubs.
 *
 * Uses `matchAll`, which clones the regex internally, so the module-level global
 * rules keep `lastIndex === 0` just like the `.replace` path. Detection scans
 * the original text while redaction rewrites the string between rules, so
 * matches that cover the same credential are collapsed here to keep one leak
 * counted once.
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
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_SCAN_LENGTH
  ) {
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
  return (
    rule.accept !== undefined && !rule.accept(match as unknown as string[])
  );
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
 * Collapse matches covering the same credential. The layers overlap by design:
 * `api_key: sk-proj-...` is at once a provider key, a vendor-shaped token and a
 * named assignment. The evaluator scores by match count, so reporting one
 * credential three times would claim three leaks. Rules are visited
 * most-specific first, so the vendor that minted the key wins over the generic
 * shape and the surrounding context.
 */
function withoutOverlaps(matches: SecretMatch[]): SecretMatch[] {
  const kept: SecretMatch[] = [];
  for (const match of matches) {
    const overlaps = kept.some(
      (other) => match.start < other.end && other.start < match.end,
    );
    if (!overlaps) kept.push(match);
  }
  return kept.sort((a, b) => a.start - b.start);
}
