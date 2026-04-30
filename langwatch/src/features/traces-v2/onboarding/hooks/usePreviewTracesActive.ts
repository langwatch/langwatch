import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * Sample preview is active when the user is *meant* to be looking at the
 * onboarding journey:
 *
 *   - the project has never received a real trace
 *     (`project.firstMessage === false`) AND the card hasn't been
 *     dismissed for this project, OR
 *   - the toolbar's Tour button has flipped `tourActive` to opt back in
 *     (regardless of the dismissal flag — we wouldn't have shown the
 *     hero otherwise).
 *
 * Without the `tourActive` branch, a user who once dismissed the card and
 * then re-entered via Tour would see the empty-state hero overlaid on a
 * blank table — `useOnboardingActive` honours `tourActive` but this hook
 * was returning false, so the trace-list query ran for real (returning 0
 * rows on a firstMessage=false project) and no fixture rows showed up.
 *
 * Sample-mode is a *purely client-side* preview. The trace table renders
 * `SAMPLE_PREVIEW_TRACES` from local memory — nothing is ingested, nothing
 * persists. The moment the user's first real trace lands the project's
 * `firstMessage` flips, this returns `false`, and `useTraceListQuery`
 * stops short-circuiting to the fixture set.
 *
 * Reading this elsewhere lets components key off the same condition
 * (e.g. disabling drawer-open on fixture rows, or flagging the row pulse
 * as "preview only").
 */
export function usePreviewTracesActive(): boolean {
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissedByProject = useOnboardingStore(
    (s) => s.setupDismissedByProject,
  );
  const tourActive = useOnboardingStore((s) => s.tourActive);
  if (!project) return false;
  if (tourActive) return true;
  if (hasAnyTraces !== false) return false;
  if (setupDismissedByProject[project.id]) return false;
  return true;
}
