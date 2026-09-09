import { toaster } from "@langwatch/design-system/toaster";

/**
 * Toast for `ModelNotConfiguredError` (cause `MODEL_NOT_CONFIGURED`): sticky
 * and informational, since a missing model is a nudge, not a failure.
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
export type MissingModelInfo = {
  /** Stable, area-prefixed snake_case key (e.g. "traces.ai_search"). */
  featureKey: string;
  /** User-facing label for the feature, from the dev-side registry. */
  featureDisplayName: string;
  /** Role the unresolved feature belongs to. */
  role: "DEFAULT" | "FAST" | "LANGY" | "EMBEDDINGS";
  /** Project slug used to deep-link the action button. */
  projectSlug?: string;
  /** Whether the caller has permission to configure model providers. */
  canConfigure?: boolean;
  /**
   * Moves the address bar to the model-providers settings page — injected
   * by the consuming feature so this shareable surface never touches
   * `window.location` itself.
   */
  navigate: (href: string) => void;
};

const ROLE_LABEL: Record<MissingModelInfo["role"], string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  LANGY: "Langy",
  EMBEDDINGS: "Embeddings",
};

export function missingModelToastId(info: MissingModelInfo): string {
  return `missing-model:${info.role}:${info.featureKey}`;
}

function settingsHref(info: { role: MissingModelInfo["role"] }): string {
  return `/settings/model-providers#role-${info.role.toLowerCase()}`;
}

/**
 * Open (or refresh) the missing-model toast. Safe to call from a tRPC
 * onError without React context — the toaster is a global singleton.
 */
export function showMissingModelToast(info: MissingModelInfo): void {
  const id = missingModelToastId(info);
  if (toaster.isVisible(id)) return;
  const roleLabel = ROLE_LABEL[info.role];
  const href = settingsHref(info);

  const description =
    info.canConfigure === false
      ? `Ask an organization or project admin to set a ${roleLabel} model.`
      : `Pick a ${roleLabel} model in Model Providers settings to enable ${info.featureDisplayName}.`;

  toaster.create({
    id,
    type: "info",
    duration: Infinity,
    title: `Model not configured for ${info.featureDisplayName}`,
    description,
    action:
      info.canConfigure === false
        ? undefined
        : {
            label: `Configure ${roleLabel} model`,
            onClick: () => {
              toaster.dismiss(id);
              info.navigate(href);
            },
          },
    meta: { type: "missing-model" },
  });
}

/**
 * Downstream AI-call failures (provider 401, malformed custom model id)
 * that aren't MODEL_NOT_CONFIGURED. No provider error string here — the
 * words come from the `ai_call_failed` presentation-registry entry.
 */
export type AiCallFailedInfo = {
  featureKey: string;
  featureDisplayName: string;
  role: MissingModelInfo["role"];
  projectSlug?: string;
  navigate: (href: string) => void;
};

export function aiCallFailedToastId(info: AiCallFailedInfo): string {
  return `ai-call-failed:${info.role}:${info.featureKey}`;
}

export function showAiCallFailedToast(info: AiCallFailedInfo): void {
  const id = aiCallFailedToastId(info);
  if (toaster.isVisible(id)) return;
  const roleLabel = ROLE_LABEL[info.role];
  const href = settingsHref(info);

  const description = `Double-check your ${roleLabel} model configuration in Model Providers.`;

  toaster.create({
    id,
    // Warning, not error: the AI call is an assistive convenience (commit
    // messages, AI search, ...) failing, not something the user was doing.
    type: "warning",
    duration: 10000,
    title: `${info.featureDisplayName} failed`,
    description,
    action: {
      label: "Open settings",
      onClick: () => {
        toaster.dismiss(id);
        info.navigate(href);
      },
    },
    meta: { type: "ai-call-failed" },
  });
}

/**
 * Toast for `ModelProviderDisabledError`: the cascade resolved a model, but
 * its provider is disabled. Swaps to the cascade-next candidate when one
 * exists; missing-model-popup.feature's provider-disabled rule.
 */
export type ProviderDisabledInfo = {
  featureKey: string;
  featureDisplayName: string;
  role: MissingModelInfo["role"];
  projectId: string;
  resolvedScope: "project" | "team" | "organization";
  resolvedModel: string;
  providerKey: string;
  alternate: {
    scope: "team" | "organization";
    model: string;
    providerKey: string;
    providerEnabled: boolean;
  } | null;
  navigate: (href: string) => void;
  /**
   * Clicking "Use {alternate.scope} default" calls this — the caller wires
   * it to clear the disabled scope's feature key so the next resolve falls
   * back to the alternate.
   */
  onSwapToAlternate?: () => Promise<void> | void;
};

export function providerDisabledToastId(info: ProviderDisabledInfo): string {
  return `provider-disabled:${info.role}:${info.featureKey}:${info.resolvedScope}`;
}

const SCOPE_LABEL: Record<ProviderDisabledInfo["resolvedScope"], string> = {
  project: "project",
  team: "team",
  organization: "organization",
};

export function showProviderDisabledToast(info: ProviderDisabledInfo): void {
  const id = providerDisabledToastId(info);
  if (toaster.isVisible(id)) return;
  const href = settingsHref(info);

  const swapAvailable = info.alternate?.providerEnabled === true && info.onSwapToAlternate;
  const altSummary = info.alternate ? info.alternate.model : null;

  const description = swapAvailable
    ? `${info.resolvedModel} is set at ${SCOPE_LABEL[info.resolvedScope]} scope, but its provider "${info.providerKey}" is disabled. The ${info.alternate?.scope} default (${info.alternate?.model}) is still available.`
    : `${info.resolvedModel} is set at ${SCOPE_LABEL[info.resolvedScope]} scope, but its provider "${info.providerKey}" is disabled. Re-enable it in Settings, or pick a different default.`;

  toaster.create({
    id,
    // The feedback port carries no offered ACTION, and this toast's whole point
    // is the one-click swap to the parent scope's default.
    type: "error", // no-raw-error-toast-ok
    duration: Infinity,
    title: `Model unavailable for ${info.featureDisplayName}`,
    description,
    action: swapAvailable
      ? {
          label: `Use ${info.alternate?.scope} default${altSummary ? ` (${altSummary})` : ""}`,
          onClick: () => {
            toaster.dismiss(id);
            void Promise.resolve(info.onSwapToAlternate?.());
          },
        }
      : {
          label: "Open settings",
          onClick: () => {
            toaster.dismiss(id);
            info.navigate(href);
          },
        },
    meta: { type: "provider-disabled" },
  });
}
