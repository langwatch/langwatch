import {
  extractAiCallFailedInfo,
  extractMissingModelInfo,
  extractProviderDisabledInfo,
} from "../../utils/trpcError";

/**
 * Whether the inline-translation failure handler should raise its own
 * generic fallback toast.
 *
 * The global tRPC error handler (utils/api.tsx) already raises an
 * actionable toast for the typed model errors — missing model, provider
 * disabled, AI call failed — so we must NOT add a second generic toast on
 * top of those. But a non-typed failure (e.g. "Project not found", a DB
 * error during model resolution) carries none of those causes, and the
 * global handler stays silent — so without a fallback the user would click
 * Translate and get no feedback at all. Return true only when none of the
 * typed extractors matched.
 */
export const shouldShowGenericTranslateError = (error: unknown): boolean =>
  !extractMissingModelInfo(error) &&
  !extractAiCallFailedInfo(error) &&
  !extractProviderDisabledInfo(error);
