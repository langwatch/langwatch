import { MediaPart } from "~/components/simulations/MediaPart";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { MediaPartData } from "~/shared/traces/mediaParts";

/**
 * Render one media content part (audio, image, video, attachment chip) via
 * the existing simulations `MediaPart`, resolving the owning `projectId` from
 * context (MediaPart needs it for the stored-object existence probe). Thin
 * adapter so every trace renderer can drop in inline media without threading
 * projectId through every call site.
 */
export function TraceMediaPart({ part }: { part: MediaPartData }) {
  const { project } = useOrganizationTeamProject();
  // MediaPart needs a real projectId for its stored-object existence probe;
  // its `enabled` gate requires `!!projectId`, so passing "" permanently
  // disables the probe — a failed media URL would then sit as a broken
  // element forever instead of resolving to the "missing" badge. Wait for the
  // project to resolve before rendering rather than handing MediaPart an
  // empty id.
  if (!project?.id) return null;
  return <MediaPart part={part} projectId={project.id} />;
}
