/**
 * The machine-readable `cause` an unhealthy health probe reports beside its
 * `reason`: the underlying error code, never a message, so a monitor can tell
 * a provider out of credits from a gateway outage without anyone opening logs.
 *
 * @see specs/ops/health-probe-cause.feature
 */

/** Longest cause a probe reports; anything longer is not a code. */
const MAX_CAUSE_LENGTH = 64;

const CODE_SHAPE = /^[a-z][a-z0-9_.:-]*$/;

/**
 * Codes recognised in free-text provider messages, for failures that arrive
 * as prose rather than a typed error chain (an AI SDK retry error, a raw
 * provider message). First match wins.
 */
const MESSAGE_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  {
    code: "insufficient_quota",
    pattern:
      /insufficient_quota|no credits remaining|exceeded your current quota/i,
  },
  { code: "budget_exceeded", pattern: /budget_exceeded|budget exceeded/i },
  { code: "auth_upstream_unavailable", pattern: /auth_upstream_unavailable/ },
  { code: "invalid_api_key", pattern: /invalid_api_key|incorrect api key/i },
  { code: "rate_limited", pattern: /rate[ _-]?limit|too many requests/i },
  { code: "model_not_found", pattern: /model_not_found/ },
];

/**
 * The cause of a failure, from a typed error, a serialized one, or its
 * message. A typed chain reports its innermost code: the outer links name
 * where it surfaced, the leaf names what went wrong. Returns undefined when
 * nothing code-shaped can be read, so the probe omits the field.
 */
export function probeCauseOf(failure: unknown): string | undefined {
  if (failure === null || failure === undefined) return undefined;
  if (typeof failure === "string") return causeFromString(failure);
  if (typeof failure !== "object") return undefined;
  return (
    leafCode(failure) ?? causeFromString(readString(failure, "message") ?? "")
  );
}

function causeFromString(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return probeCauseOf(parsed);
    } catch {
      // Not JSON after all; read it as prose below.
    }
  }
  return MESSAGE_PATTERNS.find(({ pattern }) => pattern.test(trimmed))?.code;
}

function leafCode(failure: object): string | undefined {
  const reasons = (failure as { reasons?: unknown }).reasons;
  if (Array.isArray(reasons) && reasons.length > 0) {
    const inner: unknown = reasons[0];
    if (inner && typeof inner === "object") {
      const innerCode = leafCode(inner);
      if (innerCode) return innerCode;
    }
  }
  const raw = readString(failure, "code");
  const code = raw && /^[A-Z][A-Z0-9_]*$/.test(raw) ? raw.toLowerCase() : raw;
  if (!code || code === "unknown") return undefined;
  if (code.length > MAX_CAUSE_LENGTH || !CODE_SHAPE.test(code)) {
    return undefined;
  }
  return code;
}

function readString(value: object, key: string): string | undefined {
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
