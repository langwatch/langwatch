/** A provider available to resolve a persisted model selection. */
export type ModelProviderWireTarget = {
  id: string;
  name: string;
  provider: string;
};

export type ParsedModelProviderWireValue =
  | { kind: "mp-id"; mpId: string; model: string }
  | { kind: "legacy"; provider: string; model: string }
  | { kind: "unknown"; raw: string };

export type ModelProviderWireResolution =
  | { ok: true; mp: ModelProviderWireTarget; model: string }
  | { ok: false; reason: "not_found"; value: string; hint: string }
  | {
      ok: false;
      reason: "ambiguous";
      value: string;
      candidates: ModelProviderWireTarget[];
    };

const MODEL_PROVIDER_ID_PREFIX = /^mp_/;

export function parseModelProviderWireValue(value: string): ParsedModelProviderWireValue {
  if (!value) {
    return { kind: "unknown", raw: value };
  }

  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return { kind: "unknown", raw: value };
  }

  const prefix = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (MODEL_PROVIDER_ID_PREFIX.test(prefix)) {
    return { kind: "mp-id", mpId: prefix, model };
  }

  return { kind: "legacy", provider: prefix, model };
}

export function encodeModelProviderWireValue(providerId: string, model: string): string {
  return `${providerId}/${model}`;
}

export function resolveModelProviderWireValue(
  value: string,
  accessibleProviders: ModelProviderWireTarget[],
): ModelProviderWireResolution {
  const parsed = parseModelProviderWireValue(value);
  if (parsed.kind === "unknown") {
    return {
      ok: false,
      reason: "not_found",
      value,
      hint: "Unrecognised model reference — re-select a model.",
    };
  }

  if (parsed.kind === "mp-id") {
    const provider = accessibleProviders.find((item) => item.id === parsed.mpId);
    if (provider) {
      return { ok: true, mp: provider, model: parsed.model };
    }

    return {
      ok: false,
      reason: "not_found",
      value,
      hint: `Model provider ${parsed.mpId} is not accessible to this project.`,
    };
  }

  const candidates = accessibleProviders.filter(
    (item) => item.provider === parsed.provider,
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

export function enumerateModelProviderWireValues(
  provider: string,
  model: string,
  accessibleProviders: ModelProviderWireTarget[],
): string[] {
  return accessibleProviders
    .filter((item) => item.provider === provider)
    .map((item) => encodeModelProviderWireValue(item.id, model));
}
