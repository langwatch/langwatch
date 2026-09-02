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

export { useOnboardingActive } from "../../../../behavior/explorer/onboarding/use-onboarding-active";
export type { SamplePreviewResult } from "./hooks/use-sample-preview";
export { useSamplePreview } from "./hooks/use-sample-preview";
export type { OnboardingEntryState } from "./hooks/use-tour-entry-points";
export { useTourEntryPoints } from "./hooks/use-tour-entry-points";
export { OnboardingHost } from "./onboarding-host";
export { SpotlightOverlay } from "./spotlights/spotlight-overlay";
