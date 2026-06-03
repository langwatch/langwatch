/**
 * Branch detection for the "Set up Langy" modal's model section.
 *
 * The modal adapts to what the project already has configured. This is the
 * pure decision — given the provider map the frontend already loads via
 * `api.modelProvider.getAllForProjectForFrontend`, decide which of the three
 * branches to render. Kept free of React/Chakra so it can be unit-tested
 * without a DOM and so the component stays a dumb renderer.
 *
 * Note: "enabled" here means a provider is usable (saved row or env-fed
 * system provider). It is INDEPENDENT of whether a default model is saved —
 * a project can have Anthropic enabled and still fail Langy's model gate
 * because no DEFAULT-role default is set. This branch only chooses the copy
 * and the suggested provider; satisfying the gate is the confirm action's job.
 */

export const ANTHROPIC_PROVIDER_KEY = "anthropic";

export type LangyModelBranch = "anthropic" | "other" | "none";

export interface LangyModelSetup {
  /** Which model section to render. */
  branch: LangyModelBranch;
  /** Provider keys that are enabled, sorted for deterministic display. */
  enabledProviderKeys: string[];
  /** Provider whose flagship the one-click action confirms (null in branch "none"). */
  primaryProviderKey: string | null;
  /** Show the soft "add Anthropic for the best experience" nudge (branch "other" only). */
  showAnthropicNudge: boolean;
}

/** Minimal shape we read off each provider; matches MaybeStoredModelProvider. */
type ProviderLike = { enabled?: boolean | null };

export function computeLangyModelSetup(
  providers: Record<string, ProviderLike> | undefined | null,
): LangyModelSetup {
  const enabledProviderKeys = Object.entries(providers ?? {})
    .filter(([, p]) => p?.enabled === true)
    .map(([key]) => key)
    .sort();

  if (enabledProviderKeys.includes(ANTHROPIC_PROVIDER_KEY)) {
    return {
      branch: "anthropic",
      enabledProviderKeys,
      primaryProviderKey: ANTHROPIC_PROVIDER_KEY,
      showAnthropicNudge: false,
    };
  }

  if (enabledProviderKeys.length > 0) {
    return {
      branch: "other",
      enabledProviderKeys,
      primaryProviderKey: enabledProviderKeys[0]!,
      showAnthropicNudge: true,
    };
  }

  return {
    branch: "none",
    enabledProviderKeys,
    primaryProviderKey: null,
    showAnthropicNudge: false,
  };
}
