import type { ShareLink } from "@prisma/client";
import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";
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
 * State + callbacks for the trace share drawer/dialog. Returns no JSX (see
 * dev/docs/best_practices/react.md) — the consumer renders the UI. Backs the
 * new-Trace-Explorer share experience; the legacy drawer no longer shares.
 */
export function useShareTrace({
  projectId,
  traceId,
  conversationId,
}: {
  projectId: string | undefined;
  traceId: string;
  conversationId: string | null;
}) {
  const utils = api.useUtils();
  const enabled = !!projectId;

  const linksQuery = api.share.listForResource.useQuery(
    projectId
      ? { projectId, resourceType: "TRACE" as const, resourceId: traceId }
      : (undefined as never),
    { enabled },
  );

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
      toaster.create({
        title: "Failed to create share link",
        description: error.message,
        type: "error",
      }),
  });

  const revokeMutation = api.share.revoke.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toaster.create({
        title: "Failed to revoke share link",
        description: error.message,
        type: "error",
      }),
  });

  const createLink = useCallback(
    ({
      visibility,
      expiry,
      singleView,
      includeThread,
    }: {
      visibility: ShareVisibilityOption;
      expiry: ShareExpiryOption;
      singleView: boolean;
      includeThread: boolean;
    }) => {
      if (!projectId) return;
      createMutation.mutate({
        projectId,
        resourceType: "TRACE",
        resourceId: traceId,
        threadId: includeThread ? conversationId : null,
        visibility,
        expiresAt: expiryToDate(expiry),
        maxViews: singleView ? 1 : null,
      });
    },
    [projectId, traceId, conversationId, createMutation],
  );

  const revokeLink = useCallback(
    (id: string) => {
      if (!projectId) return;
      revokeMutation.mutate({ projectId, id });
    },
    [projectId, revokeMutation],
  );

  return {
    links: (linksQuery.data ?? []) as ShareLink[],
    isLoading: enabled && linksQuery.isLoading,
    createLink,
    isCreating: createMutation.isLoading,
    revokeLink,
    isRevoking: revokeMutation.isLoading,
    canShareThread: !!conversationId,
  };
}
