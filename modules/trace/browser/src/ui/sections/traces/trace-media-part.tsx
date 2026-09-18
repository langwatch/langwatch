import { MediaPart } from "../simulations/media-part.tsx";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import type { MediaPartData } from "../../../behavior/shared/traces/media-parts.ts";

/**
 * Render one media content part (audio, image, video, attachment chip) via the existing
 * simulations `MediaPart`, resolving the owning `projectId` from context (MediaPart
 * needs it for the stored-object existence probe).
 */
export function TraceMediaPart({ part }: { part: MediaPartData }) {
  const { project } = useOrganizationTeamProject();
  // MediaPart needs real projectId for stored-object probe (empty string
  // disables it, breaking URL resolution).
  if (!project?.id) return null;
  return <MediaPart part={part} projectId={project.id} />;
}
