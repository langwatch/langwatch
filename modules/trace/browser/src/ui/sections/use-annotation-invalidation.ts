import { useCallback } from "react";

import { api } from "../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";

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
