import type { MaybeStoredModelProvider } from "./registry";

/**
 * Canonical wire format for selected models after the iter 109 multi-scope
 * refactor is `{mpId}/{modelName}` (e.g. "mp_abc123/gpt-5").
 *
 * Every caller that previously produced or consumed the legacy
 * `{provider}/{model}` format ("openai/gpt-5") still works:
 *  - When exactly one accessible ModelProvider in scope has a matching
 *    provider string, the legacy value resolves to it unambiguously.
 *  - When zero match, the resolver reports `not_found` so the UI can
 *    surface a clear "provider not configured" banner.
 *  - When more than one match, the resolver reports `ambiguous` so the
 *    UI can force the user to re-select — silently picking would route
 *    to the wrong credential.
 *
 * Keeping legacy reads is the "zero-migration" tradeoff rchaves signed
 * off on: no Prompt/Evaluator/Workflow/Monitor config needs to be
 * rewritten, and day-one behavior is unchanged for single-instance
 * providers (which is 100% of current production data).
 */
export type WireMp = Pick<
  MaybeStoredModelProvider,
  "id" | "name" | "provider"
>;

export type ParsedWireValue =
  | { kind: "mp-id"; mpId: string; model: string }
  | { kind: "legacy"; provider: string; model: string }
  | { kind: "unknown"; raw: string };

export type WireResolution =
  | { ok: true; mp: WireMp; model: string }
  | { ok: false; reason: "not_found"; value: string; hint: string }
  | { ok: false; reason: "ambiguous"; value: string; candidates: WireMp[] };

const MP_ID_PREFIX_RE = /^mp_/;

/**
 * Parse a stored wire value into either an MP-keyed form or a legacy
 * provider-keyed form. Never throws; an uninterpretable value becomes
 * `{ kind: "unknown", raw }`.
 */
export function parseWireValue(value: string): ParsedWireValue {
  if (!value) return { kind: "unknown", raw: value };
  const slashIdx = value.indexOf("/");
  if (slashIdx <= 0 || slashIdx === value.length - 1) {
    return { kind: "unknown", raw: value };
  }
  const prefix = value.slice(0, slashIdx);
  const model = value.slice(slashIdx + 1);
  if (MP_ID_PREFIX_RE.test(prefix)) {
    return { kind: "mp-id", mpId: prefix, model };
  }
  return { kind: "legacy", provider: prefix, model };
}

/**
 * Encode a ModelProvider + model pair into the canonical wire format.
 * Callers that have an MP in hand should always produce this format;
 * the legacy shape is only accepted at read-time for backwards compat.
 */
export function encodeWireValue(mpId: string, model: string): string {
  return `${mpId}/${model}`;
}

/**
 * Resolve a stored wire value against the set of ModelProviders the
 * current user is allowed to see. Returns the target MP + model when
 * the value is unambiguous, or a typed failure the UI can render.
 */
export function resolveWireValue(
  value: string,
  accessibleMps: WireMp[],
): WireResolution {
  const parsed = parseWireValue(value);
  if (parsed.kind === "unknown") {
    return {
      ok: false,
      reason: "not_found",
      value,
      hint: "Unrecognised model reference — re-select a model.",
    };
  }
  if (parsed.kind === "mp-id") {
    const mp = accessibleMps.find((m) => m.id === parsed.mpId);
    if (mp) return { ok: true, mp, model: parsed.model };
    return {
      ok: false,
      reason: "not_found",
      value,
      hint: `Model provider ${parsed.mpId} is not accessible to this project.`,
    };
  }
  // Legacy `provider/model` path.
  const candidates = accessibleMps.filter(
    (m) => m.provider === parsed.provider,
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "not_found",
      value,
      hint: `Provider ${parsed.provider} is not configured for this project.`,
    };
  }
  if (candidates.length === 1) {
    return { ok: true, mp: candidates[0]!, model: parsed.model };
  }
  return {
    ok: false,
    reason: "ambiguous",
    value,
    candidates,
  };
}

/**
 * Given a set of accessible ModelProviders and a concrete model string
 * (e.g. "gpt-5"), build every wire value that would route to that
 * model. When more than one MP exposes the same provider this produces
 * multiple values — the UI uses that to show a grouped picker.
 */
export function enumerateWireValuesForModel(
  provider: string,
  model: string,
  accessibleMps: WireMp[],
): string[] {
  return accessibleMps
    .filter((m) => m.provider === provider)
    .map((m) => (m.id ? encodeWireValue(m.id, model) : `${provider}/${model}`));
}
