/**
 * Public API for the traces-v2 onboarding module.
 *
 * Anything outside this module should import only from here. Internal
 * shapes (StageId, store slices, chapter definitions, hero components)
 * stay opaque so the rest of the codebase doesn't accidentally couple
 * to onboarding internals.
 *
 * See ./README.md for the migration story and lazy-mount discipline.
 */

export { OnboardingHost } from "./OnboardingHost";
export { useOnboardingActive } from "./hooks/useOnboardingActive";
export { useSamplePreview } from "./hooks/useSamplePreview";
export type { SamplePreviewResult } from "./hooks/useSamplePreview";
export { useTourEntryPoints } from "./hooks/useTourEntryPoints";
export type { OnboardingEntryState } from "./hooks/useTourEntryPoints";
