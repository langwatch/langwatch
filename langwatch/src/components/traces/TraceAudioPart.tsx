import {
  MediaPart,
  type MediaPartData,
} from "~/components/simulations/MediaPart";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Render one audio content part via the existing simulations `MediaPart`,
 * resolving the owning `projectId` from context (MediaPart needs it for the
 * stored-object existence probe). Thin adapter so both trace renderers can drop
 * in an inline player without threading projectId through every call site.
 */
export function TraceAudioPart({ part }: { part: MediaPartData }) {
  const { project } = useOrganizationTeamProject();
  // MediaPart needs a real projectId for its stored-object existence probe;
  // its `enabled` gate requires `!!projectId`, so passing "" permanently
  // disables the probe — a failed audio URL would then sit as a broken player
  // forever instead of resolving to the "missing" badge. Wait for the project
  // to resolve before rendering rather than handing MediaPart an empty id.
  if (!project?.id) return null;
  return <MediaPart part={part} projectId={project.id} />;
}
