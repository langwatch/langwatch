/**
 * The `cause` an unhealthy probe reports beside its `reason`: the underlying
 * error code, never a message. Ported from main's `health-probes/probe-cause.ts`.
 * @see specs/ops/health-probe-cause.feature
 */

/** Longest cause a probe reports; anything longer is not a code. */
const MAX_CAUSE_LENGTH = 64;

const CODE_SHAPE = /^[a-z][a-z0-9_.:-]*$/;

/** Codes read from free-text provider messages, for failures without a typed chain. First wins. */
const MESSAGE_PATTERNS: readonly { code: string; pattern: RegExp }[] = [
  {
    code: "insufficient_quota",
    pattern: /insufficient_quota|no credits remaining|exceeded your current quota/i,
  },
  { code: "budget_exceeded", pattern: /budget_exceeded|budget exceeded/i },
  { code: "auth_upstream_unavailable", pattern: /auth_upstream_unavailable/ },
  { code: "invalid_api_key", pattern: /invalid_api_key|incorrect api key/i },
  { code: "rate_limited", pattern: /rate[ _-]?limit|too many requests/i },
  { code: "model_not_found", pattern: /model_not_found/ },
];

/**
 * The cause of a failure, from a typed error, a serialized one, or its message.
 * A typed chain reports its innermost code (the leaf names what went wrong).
 * Undefined when nothing code-shaped can be read, so the probe omits the field.
 */
export function deriveProbeCause(failure: unknown): string | undefined {
  if (failure === null || failure === undefined) return undefined;
  if (typeof failure === "string") return extractCauseFromText(failure);
  if (typeof failure !== "object") return undefined;
  return extractLeafCode(failure) ?? extractCauseFromText(pickString(failure, "message") ?? "");
}

function extractCauseFromText(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return deriveProbeCause(parsed);
    } catch {
      // Not JSON after all; read it as prose below.
    }
  }
  return MESSAGE_PATTERNS.find(({ pattern }) => pattern.test(trimmed))?.code;
}

function extractLeafCode(failure: object): string | undefined {
  const inner = pickFirstReason(failure);
  return (inner && extractLeafCode(inner)) ?? extractOwnCode(failure);
}

function pickFirstReason(failure: object): object | undefined {
  const reasons = "reasons" in failure ? failure.reasons : undefined;
  const inner: unknown = Array.isArray(reasons) ? reasons[0] : undefined;
  return inner && typeof inner === "object" ? inner : undefined;
}

function extractOwnCode(failure: object): string | undefined {
  const raw = pickString(failure, "code");
  if (!raw) return undefined;
  const code = /^[A-Z][A-Z0-9_]*$/.test(raw) ? raw.toLowerCase() : raw;
  const isCode = code !== "unknown" && code.length <= MAX_CAUSE_LENGTH && CODE_SHAPE.test(code);
  return isCode ? code : undefined;
}

function pickString<K extends string>(value: { [P in K]?: unknown }, key: K): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}
