/**
 * The one place a model-resolution refusal becomes something the reader sees.
 * Installed once over every failed mutation; a screen's own `onError` asks
 * `isHandledBy*` and stays quiet. specs/model-providers/missing-model-popup.feature.
 */

import { showErrorToast } from "@langwatch/browser-host/errors";
import {
  extractAiCallFailedInfo,
  extractAiContentFilteredInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
  markAsHandledByContentFilterHandler,
  markAsHandledByMissingModelHandler,
  markAsHandledByProviderDisabledHandler,
  type ProviderDisabledExtracted,
} from "@langwatch/browser-host/model-error";

import {
  showAiCallFailedToast,
  showMissingModelToast,
  showProviderDisabledToast,
} from "./missing-model-toast.ts";

/**
 * What the composing application lends the interceptor: the two things it can
 * do that a shareable surface may not do for itself.
 */
export type ModelErrorRemediation = {
  /** Moves the address bar to the model-providers settings page. */
  navigate: (href: string) => void;
  /**
   * Clears a PROJECT-scope feature override so the next resolve falls through
   * to the parent scope's default. Backs the toast's one-click swap.
   */
  clearProjectFeatureModel: (input: { projectId: string; featureKey: string }) => Promise<void>;
};

/**
 * The swap callback, only where the swap is performable: the disabled scope is
 * the project's own, and the alternate's provider is enabled. Otherwise the
 * toast falls back to its settings deep-link — actionable, not one click.
 */
function swapToAlternate(
  info: ProviderDisabledExtracted,
  remediation: ModelErrorRemediation,
): (() => Promise<void>) | undefined {
  if (info.resolvedScope !== "project") return undefined;
  if (!info.alternate?.providerEnabled) return undefined;
  return () =>
    remediation.clearProjectFeatureModel({
      projectId: info.projectId,
      featureKey: info.featureKey,
    });
}

/** Resolved, but the chosen model's provider is switched off. */
function reportProviderDisabled(error: unknown, remediation: ModelErrorRemediation): boolean {
  const providerDisabled = extractProviderDisabledInfo(error);
  if (!providerDisabled) return false;
  if (error instanceof Error) markAsHandledByProviderDisabledHandler(error);
  const onSwapToAlternate = swapToAlternate(providerDisabled, remediation);
  showProviderDisabledToast({
    ...providerDisabled,
    navigate: remediation.navigate,
    ...(onSwapToAlternate ? { onSwapToAlternate } : {}),
  });
  return true;
}

/**
 * Resolved and configured, but the provider's content filter refused the text: no settings fix
 * applies, so the registry's own copy says so and no settings link is offered.
 */
function reportContentFilterRefusal(error: unknown): boolean {
  const contentFiltered = extractAiContentFilteredInfo(error);
  if (!contentFiltered) return false;
  showErrorToast({
    error,
    fallbackTitle: `${contentFiltered.featureDisplayName} failed`,
    id: `ai-content-filtered:${contentFiltered.role}:${contentFiltered.featureKey}`,
  });
  if (error instanceof Error) markAsHandledByContentFilterHandler(error);
  return true;
}

/**
 * Builds the interceptor. It answers whether it reported the failure, which is
 * the caller's signal that nothing else needs to.
 */
export function createModelErrorInterceptor(
  remediation: ModelErrorRemediation,
): (error: unknown) => boolean {
  const { navigate } = remediation;

  return (error: unknown): boolean => {
    let reported = false;

    // Nothing resolved anywhere in the scope chain. A sticky, informational
    // toast rather than a focus-trapping dialog: an explicit action still gets
    // a clear nudge, and a background flow does not block behind a dialog.
    const missingModel = extractMissingModelInfo(error);
    if (missingModel) {
      if (error instanceof Error) markAsHandledByMissingModelHandler(error);
      showMissingModelToast({ ...missingModel, navigate });
      reported = true;
    }

    // Resolved, but the provider answered with a failure. Most of these trace
    // back to a misset key or a wrong model id, so the toast nudges towards
    // the configuration rather than repeating the provider's own sentence.
    const aiCallFailed = extractAiCallFailedInfo(error);
    if (aiCallFailed) {
      showAiCallFailedToast({ ...aiCallFailed, navigate });
      reported = true;
    }

    if (reportContentFilterRefusal(error)) reported = true;

    if (reportProviderDisabled(error, remediation)) reported = true;

    return reported;
  };
}
