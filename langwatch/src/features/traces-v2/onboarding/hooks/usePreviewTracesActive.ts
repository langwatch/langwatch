import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * Sample preview is active when the user is *meant* to be seeing sample
 * trace fixtures in the table:
 *
 *   - the project has never received a real trace
 *     (`project.firstMessage === false`) — sample traces are shown by
 *     default so the empty table isn't a blank void, OR
 *   - the toolbar's "See sample data" button has set `showSamplePreview`
 *     (explicit opt-in for projects that already have real traces), OR
 *   - the legacy `tourActive` flag is set (backwards compat with the
 *     journey state machine, dormant until Phase 2 replaces it).
 *
 * For no-traces projects the legacy `setupDismissedByProject` flag is
 * intentionally NOT checked here — sample rows are always shown for
 * no-traces users regardless of whether they dismissed the setup card.
 * The card dismissal only hides the CTA card, not the sample data.
 *
 * Sample-mode is a *purely client-side* preview. The trace table renders
 * `SAMPLE_PREVIEW_TRACES` from local memory — nothing is ingested, nothing
 * persists. The moment the user's first real trace lands the project's
 * `firstMessage` flips, `hasAnyTraces` becomes true, and this returns
 * `false` (unless the user has explicitly opted in via the toolbar).
 *
 * Reading this elsewhere lets components key off the same condition
 * (e.g. disabling drawer-open on fixture rows, or flagging the row pulse
 * as "preview only").
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
