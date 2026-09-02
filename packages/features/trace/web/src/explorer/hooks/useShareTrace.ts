import type { ShareLink } from "@langwatch/share-contract";
import { expiryToDate, type CreateShareLinkDraft } from "@langwatch/share-web";
import { useCallback } from "react";
import { showErrorToast } from "../../features/errors";
import { api } from "../../behavior/trace-api";

/**
 * The share-links list query, scoped to a resource. Split out of
 * {@link useShareTrace} so the public hook stays a thin composition (see
 * dev/docs/best_practices/react.md's function-size budget).
 */
function useShareLinksQuery({
  projectId,
  traceId,
  enabled,
}: {
  projectId: string | undefined;
  traceId: string;
  enabled: boolean;
}) {
  const linksQuery = api.share.listForResource.useQuery(
    projectId
      ? { projectId, resourceType: "TRACE" as const, resourceId: traceId }
      : (undefined as never),
    { enabled },
  );

  const links: ShareLink[] = linksQuery.data ?? [];

  return {
    links,
    isLoading: enabled && linksQuery.isLoading,
    // Surfaced so the dialog can tell a fetch failure apart from "no links yet".
    isError: enabled && linksQuery.isError,
  };
}

/** Create + revoke mutations, both invalidating the resource's link list. */
function useShareLinkMutations({
  projectId,
  traceId,
}: {
  projectId: string | undefined;
  traceId: string;
}) {
  const utils = api.useUtils();

  const invalidate = useCallback(() => {
    if (!projectId) return;
    void utils.share.listForResource.invalidate({
      projectId,
      resourceType: "TRACE",
      resourceId: traceId,
    });
  }, [utils, projectId, traceId]);

  const createMutation = api.share.createShare.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create the share link",
      }),
  });

  const revokeMutation = api.share.revoke.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't revoke the share link",
      }),
  });

  const createLink = useCallback(
    ({ visibility, expiry, isSingleView }: CreateShareLinkDraft) => {
      if (!projectId) return;
      // TRACE only — thread sharing is parked until the share viewer can
      // render the surrounding conversation. See ADR-057's follow-ups.
      createMutation.mutate({
        projectId,
        resourceType: "TRACE",
        resourceId: traceId,
        visibility,
        expiresAt: expiryToDate({ option: expiry }),
        maxViews: isSingleView ? 1 : null,
      });
    },
    [projectId, traceId, createMutation],
  );

  const revokeLink = useCallback(
    (id: string) => {
      if (!projectId) return;
      revokeMutation.mutate({ projectId, id });
    },
    [projectId, revokeMutation],
  );

  return {
    createLink,
    isCreating: createMutation.isPending,
    revokeLink,
    /** Which link is being revoked, so only that row shows a spinner. */
    revokingId: revokeMutation.isPending ? (revokeMutation.variables?.id ?? null) : null,
  };
}

/**
 * Transport for the trace share dialog: the tRPC reads and writes, and nothing
 * else. Returns no JSX (see dev/docs/best_practices/react.md) — the consumer
 * renders `ShareTraceDialogBody` from `@langwatch/share-web` with this state.
 */
export function useShareTrace({
  projectId,
  traceId,
  active = true,
}: {
  projectId: string | undefined;
  traceId: string;
  /** Only fetch links while the share surface is open. The dialog is mounted by
   *  the drawer header on every render, so without this the list query fires for
   *  every trace anyone opens — including anonymous share viewers, who 401. */
  active?: boolean;
}) {
  const enabled = !!projectId && active;
  const query = useShareLinksQuery({ projectId, traceId, enabled });
  const mutations = useShareLinkMutations({ projectId, traceId });
  return { ...query, ...mutations };
}
