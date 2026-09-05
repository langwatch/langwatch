/**
 * Public API for the traces-v2 onboarding module.
 */

export { useOnboardingActive } from "../../../../behavior/explorer/onboarding/use-onboarding-active";
export type { SamplePreviewResult } from "./hooks/use-sample-preview";
export { useSamplePreview } from "./hooks/use-sample-preview";
export type { OnboardingEntryState } from "./hooks/use-tour-entry-points";
export { useTourEntryPoints } from "./hooks/use-tour-entry-points";
export { OnboardingHost } from "./onboarding-host";
export { SpotlightOverlay } from "./spotlights/spotlight-overlay";
