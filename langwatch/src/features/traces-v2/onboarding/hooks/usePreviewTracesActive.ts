import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * Sample preview is active only while the user is actually in the tour
 * (`tourActive`). The tour is opt-in — a never-traced project shows the
 * normal empty state, not the fixture-backed journey — so the preview no
 * longer auto-fires on `firstMessage === false`. The "Take the tour"
 * button flips `tourActive`, which turns this on.
 *
 * Sample-mode is a *purely client-side* preview. The trace table renders
 * `SAMPLE_PREVIEW_TRACES` from local memory — nothing is ingested, nothing
 * persists. Ending the tour flips `tourActive` back to false and
 * `useTraceListQuery` stops short-circuiting to the fixture set.
 *
 * Reading this elsewhere lets components key off the same condition
 * (e.g. disabling drawer-open on fixture rows, or flagging the row pulse
 * as "preview only").
 */
export function usePreviewTracesActive(): boolean {
  const { project } = useOrganizationTeamProject();
  const tourActive = useOnboardingStore((s) => s.tourActive);
  if (!project) return false;
  return tourActive;
}
