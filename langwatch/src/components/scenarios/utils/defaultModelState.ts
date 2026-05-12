import { getProviderFromModel } from "~/utils/modelProviderHelpers";

/**
 * Discriminated state for the project's default model configuration.
 *
 * - ok: true — default model has a configured, enabled provider
 * - no-providers — no model providers enabled at all
 * - no-default — project has no default model set
 * - stale-default — default model's provider is disabled
 */
export type DefaultModelState =
  | { ok: true }
  | { ok: false; reason: "no-providers" }
  | { ok: false; reason: "no-default" }
  | { ok: false; reason: "stale-default" };

/**
 * Derives the default model state from provider settings and project config.
 *
 * Returns ok:true during loading (when providers is undefined or empty but
 * hasEnabledProviders is true) to avoid flashing error banners prematurely.
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
