import type { ExtractorContext } from "../ports/canonical-attributes.port";

export const CODEX_EVENT_NAME_PREFIX = "codex.";
export const CODEX_PROVIDER_KEY = "openai_codex";
const CODEX_RUST_SCOPE_NAME = "codex_cli_rs";

export const isCodexModel = (modelId: string): boolean =>
  modelId.startsWith(`${CODEX_PROVIDER_KEY}/`);

export const CODEX_EXEC_SCOPE_NAME = "codex_exec";
export const CODEX_SCOPE_NAMES: ReadonlySet<string> = new Set([
  CODEX_RUST_SCOPE_NAME,
  CODEX_EXEC_SCOPE_NAME,
]);
export const CODEX_REDUNDANT_USAGE_SPAN_NAMES = new Set(["handle_responses"]);

export const asNumber = (raw: unknown): number | null => {
  if (raw === void 0 || raw === null || raw === "") {
    return null;
  }
  let n = NaN;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    n = Number(raw);
  }
  return Number.isFinite(n) ? n : null;
};

export const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export const positiveOrNull = (n: number | null): number | null =>
  n !== null && n > 0 ? n : null;

export type CanonicalLift = readonly [string, string | number | null];

export const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function conversationIdOf(attrs: {
  get: (key: string) => unknown;
  take: (key: string) => unknown;
}): string | null {
  const sessionId = asString(attrs.get("thread.id"));
  const turnId = asString(attrs.take("turn.id"));
  return sessionId !== null && UUID_SHAPE.test(sessionId) ? sessionId : turnId;
}

export function nonCachedInput({
  attrs,
  cacheRead,
  cacheCreation,
}: {
  attrs: { get: (key: string) => unknown; take: (key: string) => unknown };
  cacheRead: number | null;
  cacheCreation: number | null;
}): number | null {
  const own = asNumber(attrs.get("codex.turn.token_usage.non_cached_input_tokens"));
  const whole = asNumber(attrs.take("codex.turn.token_usage.input_tokens"));
  if (own !== null) {
    return own;
  }
  if (whole === null) {
    return null;
  }
  return Math.max(0, whole - (cacheRead ?? 0) - (cacheCreation ?? 0));
}

export function applyCanonicalLifts(
  ctx: ExtractorContext,
  lifts: readonly CanonicalLift[],
): boolean {
  let fired = false;
  for (const [key, value] of lifts) {
    if (value === null) {
      continue;
    }
    ctx.setAttrIfAbsent(key, value);
    fired = true;
  }
  return fired;
}
