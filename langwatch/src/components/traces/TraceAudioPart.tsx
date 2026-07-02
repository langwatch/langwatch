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
  return <MediaPart part={part} projectId={project?.id ?? ""} />;
}
