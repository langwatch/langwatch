import type { ShareLink } from "@prisma/client";
import { useCallback } from "react";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

export type ShareVisibilityOption = "PUBLIC" | "ORGANIZATION" | "PROJECT";
export type ShareExpiryOption = "never" | "1h" | "24h" | "7d" | "30d";

const EXPIRY_MS: Record<Exclude<ShareExpiryOption, "never">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function expiryToDate(option: ShareExpiryOption): Date | null {
  if (option === "never") return null;
  return new Date(Date.now() + EXPIRY_MS[option]);
}

export function shareUrlForToken(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}

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

  return {
    links: (linksQuery.data ?? []) as ShareLink[],
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
      showErrorToast({ error, fallbackTitle: "Couldn't create share link" }),
  });

  const revokeMutation = api.share.revoke.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't revoke share link" }),
  });

  const createLink = useCallback(
    ({
      visibility,
      expiry,
      isSingleView,
    }: {
      visibility: ShareVisibilityOption;
      expiry: ShareExpiryOption;
      isSingleView: boolean;
    }) => {
      if (!projectId) return;
      // TRACE only — thread sharing is parked until the share viewer can
      // render the surrounding conversation. See ADR-057's follow-ups.
      createMutation.mutate({
        projectId,
        resourceType: "TRACE",
        resourceId: traceId,
        visibility,
        expiresAt: expiryToDate(expiry),
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
    isCreating: createMutation.isLoading,
    revokeLink,
    /** Which link is being revoked, so only that row shows a spinner. */
    revokingId: revokeMutation.isLoading
      ? (revokeMutation.variables?.id ?? null)
      : null,
  };
}

/**
 * State + callbacks for the trace share drawer/dialog. Returns no JSX (see
 * dev/docs/best_practices/react.md) — the consumer renders the UI. Backs the
 * new-Trace-Explorer share experience; the legacy drawer no longer shares.
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
