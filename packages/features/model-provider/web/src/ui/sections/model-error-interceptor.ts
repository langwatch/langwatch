/**
 * The one place a model-resolution refusal becomes something the reader sees.
 * Installed once over every failed mutation; a screen's own `onError` asks
 * `isHandledBy*` and stays quiet. specs/model-providers/missing-model-popup.feature.
 */

import {
  extractAiCallFailedInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
  markAsHandledByMissingModelHandler,
  markAsHandledByProviderDisabledHandler,
  type ProviderDisabledExtracted,
} from "../../model/model-error";
import {
  showAiCallFailedToast,
  showMissingModelToast,
  showProviderDisabledToast,
} from "./missing-model-toast";

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

    // Resolved, but the chosen model's provider is switched off.
    const providerDisabled = extractProviderDisabledInfo(error);
    if (providerDisabled) {
      if (error instanceof Error) markAsHandledByProviderDisabledHandler(error);
      const onSwapToAlternate = swapToAlternate(providerDisabled, remediation);
      showProviderDisabledToast({
        ...providerDisabled,
        navigate,
        ...(onSwapToAlternate ? { onSwapToAlternate } : {}),
      });
      reported = true;
    }

    return reported;
  };
}
