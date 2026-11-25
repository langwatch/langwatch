/**
 * The provider key a model string names.
 */
const getProviderFromModel = (model: string): string => model.split("/")[0] ?? "";

/**
 * Discriminated state for the project's default model configuration.
 */
export type DefaultModelState =
  | { ok: true }
  | { ok: false; reason: "no-providers" }
  | { ok: false; reason: "no-default" }
  | { ok: false; reason: "stale-default" };

/**
 * Derives the default model state from provider settings and project config.
 */
export function getDefaultModelState({
  hasEnabledProviders,
  providers,
  defaultModel,
}: {
  hasEnabledProviders: boolean;
  providers: Record<string, { enabled: boolean }> | undefined;
  defaultModel: string | null | undefined;
}): DefaultModelState {
  // While providers haven't loaded yet, don't flash errors
  if (!providers || Object.keys(providers).length === 0) {
    if (hasEnabledProviders) return { ok: true };
    return { ok: false, reason: "no-providers" };
  }

  if (!hasEnabledProviders) return { ok: false, reason: "no-providers" };
  if (!defaultModel) return { ok: false, reason: "no-default" };

  const providerKey = getProviderFromModel(defaultModel);
  if (!providers[providerKey]?.enabled) {
    return { ok: false, reason: "stale-default" };
  }

  return { ok: true };
}
