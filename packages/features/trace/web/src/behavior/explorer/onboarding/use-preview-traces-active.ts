import { useOrganizationTeamProject } from "../../use-organization-team-project";
import { useProjectHasTraces } from "../use-project-has-traces";
import { useOnboardingStore } from "./store/onboarding-store";

/**
 * Sample preview is active when the user is *meant* to be seeing sample trace fixtures
 * in the table:
 */
export function usePreviewTracesActive(): boolean {
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const tourActive = useOnboardingStore((s) => s.tourActive);
  const showSamplePreview = useOnboardingStore((s) => s.showSamplePreview);
  if (!project) return false;
  // Legacy journey override — keeps the old tour state machine's sample
  // injection path alive until Phase 2 removes the journey.
  if (tourActive) return true;
  // Explicit opt-in via "See sample data" toolbar button.
  if (showSamplePreview) return true;
  // No real traces yet → show sample data by default so the table isn't blank.
  if (hasAnyTraces === false) return true;
  return false;
}
