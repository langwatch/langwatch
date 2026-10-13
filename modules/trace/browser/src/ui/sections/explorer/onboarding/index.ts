/**
 * Public API for the traces-v2 onboarding module.
 */

export { useOnboardingActive } from "../../../../behavior/explorer/onboarding/use-onboarding-active.ts";
export type { SamplePreviewResult } from "../../../../behavior/explorer/onboarding/use-sample-preview.ts";
export { useSamplePreview } from "../../../../behavior/explorer/onboarding/use-sample-preview.ts";
export type { OnboardingEntryState } from "./hooks/use-tour-entry-points.ts";
export { useTourEntryPoints } from "./hooks/use-tour-entry-points.ts";
export { OnboardingHost } from "./onboarding-host.tsx";
export { SpotlightOverlay } from "./spotlights/spotlight-overlay.tsx";
