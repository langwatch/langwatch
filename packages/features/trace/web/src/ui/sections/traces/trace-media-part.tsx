import { MediaPart } from "../simulations/media-part";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import type { MediaPartData } from "../../../behavior/shared/traces/media-parts";

/**
 * Render one media content part (audio, image, video, attachment chip) via the existing
 * simulations `MediaPart`, resolving the owning `projectId` from context (MediaPart
 * needs it for the stored-object existence probe).
 */
export function TraceMediaPart({ part }: { part: MediaPartData }) {
  const { project } = useOrganizationTeamProject();
  // MediaPart needs a real projectId for its stored-object existence probe; its `enabled` gate requires
  // `!!projectId`, so passing "" permanently disables the probe — a failed media URL would then sit as a broken
  // element forever instead of resolving to the "missing" badge.
  if (!project?.id) return null;
  return <MediaPart part={part} projectId={project.id} />;
}
