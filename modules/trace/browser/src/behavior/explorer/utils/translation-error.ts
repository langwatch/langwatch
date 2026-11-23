import {
  extractAiCallFailedInfo,
  extractAiContentFilteredInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
} from "@langwatch/browser-host/model-error";

/**
 * Whether the inline-translation failure handler should raise its own generic fallback
 * toast.
 */
export const shouldShowGenericTranslateError = (error: unknown): boolean =>
  !extractMissingModelInfo(error) &&
  !extractAiCallFailedInfo(error) &&
  !extractAiContentFilteredInfo(error) &&
  !extractProviderDisabledInfo(error);
