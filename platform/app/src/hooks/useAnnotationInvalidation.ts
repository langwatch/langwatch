import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Everything an annotation write on one trace makes stale, in one place.
 *
 * Three reads go out of date at once, and each is read by a different surface:
 * the per-trace annotation list behind a turn's badge, the batched feed the
 * conversation counts and lists every turn from, and the trace's stored
 * correction. Missing the batched feed leaves the reviewer's own annotation
 * invisible until its cache expires; missing the correction lets an edit
 * session started later build on a stale copy and undo a suggestion on save.
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
