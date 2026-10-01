import {
  extractAiCallFailedInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
} from "@langwatch/model-provider-browser-kit";

/**
 * Whether the inline-translation failure handler should raise its own generic fallback
 * toast.
 */
export const shouldShowGenericTranslateError = (error: unknown): boolean =>
  !extractMissingModelInfo(error) &&
  !extractAiCallFailedInfo(error) &&
  !extractProviderDisabledInfo(error);
