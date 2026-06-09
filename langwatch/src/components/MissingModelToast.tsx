import { toaster } from "./ui/toaster";

/**
 * Toast emitted by the global tRPC / Hono error interceptors when an API
 * call fails with a `ModelNotConfiguredError` (cause code
 * `MODEL_NOT_CONFIGURED`).
 *
 * Why toast and not modal: the previous design opened a full Dialog,
 * which felt heavy for background flows (AI search, auto-saved
 * commit-message generation). A sticky orange toast with a deep-link
 * action button is just as discoverable but doesn't trap focus.
 *
 * The toaster system already lives at the app root; we don't mount any
 * extra component for this. Stable per-(featureKey, role) toast IDs
 * dedupe retry storms so identical errors don't stack.
 *
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
export type MissingModelInfo = {
  /** Stable, area-prefixed snake_case key (e.g. "traces.ai_search"). */
  featureKey: string;
  /** User-facing label for the feature, from the dev-side registry. */
  featureDisplayName: string;
  /** Role the unresolved feature belongs to. */
  role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  /** Project slug used to deep-link the action button. */
  projectSlug?: string;
  /** Whether the caller has permission to configure model providers. */
  canConfigure?: boolean;
};

const ROLE_LABEL: Record<MissingModelInfo["role"], string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

export function missingModelToastId(info: MissingModelInfo): string {
  return `missing-model:${info.role}:${info.featureKey}`;
}

function settingsHref(info: MissingModelInfo): string {
  // /settings/model-providers is a top-level route in the Vite app —
  // the legacy `/${slug}/settings/...` shape 404s now. Project slug is
  // kept on MissingModelInfo for analytics / future deep-linking but
  // isn't part of the URL.
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
    type: "error",
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
              window.location.assign(href);
            },
          },
    meta: { closable: true, type: "missing-model" },
  });
}

/**
 * Variant for downstream AI-call failures that aren't a
 * MODEL_NOT_CONFIGURED — e.g. the provider returns 401 because the
 * caller's API key is wrong, or the SDK throws because a custom model
 * id no longer exists in the registry. The user-facing toast adds a
 * "double-check your model configuration" hint so the most common
 * cause (a misconfigured provider) is the first thing they think to
 * verify.
 */
export type AiCallFailedInfo = {
  featureKey: string;
  featureDisplayName: string;
  role: MissingModelInfo["role"];
  projectSlug?: string;
  /** Best-effort short error message from the provider/SDK. */
  errorMessage?: string;
};

export function aiCallFailedToastId(info: AiCallFailedInfo): string {
  return `ai-call-failed:${info.role}:${info.featureKey}`;
}

export function showAiCallFailedToast(info: AiCallFailedInfo): void {
  const id = aiCallFailedToastId(info);
  if (toaster.isVisible(id)) return;
  const roleLabel = ROLE_LABEL[info.role];
  const href = settingsHref({ ...info, canConfigure: true });

  const description = info.errorMessage
    ? `Double-check your ${roleLabel} model configuration in Model Providers. ${info.errorMessage}`
    : `Double-check your ${roleLabel} model configuration in Model Providers.`;

  toaster.create({
    id,
    type: "error",
    duration: 10000,
    title: `${info.featureDisplayName} failed`,
    description,
    action: {
      label: "Open settings",
      onClick: () => {
        toaster.dismiss(id);
        window.location.assign(href);
      },
    },
    meta: { closable: true, type: "ai-call-failed" },
  });
}

/**
 * Toast variant for `ModelProviderDisabledError` — the cascade DID
 * resolve a model, but that model's backing provider is currently
 * disabled. The primary CTA is a one-click swap to the cascade-next
 * candidate (if any) by deleting the disabled scope's key for this
 * feature; the fallback is a deep-link to settings.
 *
 * UX contract: specs/model-providers/missing-model-popup.feature
 * (the "Provider disabled" rule).
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
  /**
   * Called when the user clicks "Use {alternate.scope} default" — must
   * delete the disabled-scope's feature key so the next resolve falls
   * back to the alternate. Injected by the caller (interceptor) to
   * avoid a circular import between this module and `~/utils/api`.
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
  const href = settingsHref({ ...info, canConfigure: true });

  const swapAvailable =
    info.alternate?.providerEnabled === true && info.onSwapToAlternate;
  const altSummary = info.alternate ? info.alternate.model : null;

  const description = swapAvailable
    ? `${info.resolvedModel} is set at ${SCOPE_LABEL[info.resolvedScope]} scope, but its provider "${info.providerKey}" is disabled. The ${info.alternate?.scope} default (${info.alternate?.model}) is still available.`
    : `${info.resolvedModel} is set at ${SCOPE_LABEL[info.resolvedScope]} scope, but its provider "${info.providerKey}" is disabled. Re-enable it in Settings, or pick a different default.`;

  toaster.create({
    id,
    type: "error",
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
            window.location.assign(href);
          },
        },
    meta: { closable: true, type: "provider-disabled" },
  });
}
