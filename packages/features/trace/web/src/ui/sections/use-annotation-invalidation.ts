import { useCallback } from "react";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api } from "../../behavior/trace-api";

/**
 * Everything an annotation write on one trace makes stale, in one place.
 */
export function useAnnotationInvalidation({ traceId }: { traceId: string }) {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useUtils();

  return useCallback(() => {
    void trpc.annotation.getByTraceId.invalidate();
    void trpc.annotation.getByTraceIds.invalidate();
    if (!project?.id) return;
    void trpc.traceEditOverlay.getByTraceId.invalidate({
      projectId: project.id,
      traceId,
    });
  }, [trpc, project?.id, traceId]);
}
