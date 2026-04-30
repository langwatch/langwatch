import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useUIStore } from "../stores/uiStore";
import { useProjectHasTraces } from "./useProjectHasTraces";

/**
 * Sample preview is active when:
 *
 *   - the project has never received a real trace
 *     (`project.firstMessage === false`), AND
 *   - the user hasn't dismissed the onboarding card for this project.
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
  const setupDismissedByProject = useUIStore((s) => s.setupDismissedByProject);
  if (!project) return false;
  if (hasAnyTraces !== false) return false;
  if (setupDismissedByProject[project.id]) return false;
  return true;
}
