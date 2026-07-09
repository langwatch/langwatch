import { createLogger } from "@langwatch/observability";
import type { ShareLink, ShareVisibility } from "@prisma/client";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import type {
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./repositories/share.repository";
import { generateShareToken } from "./share.token";

const logger = createLogger("langwatch:share-service");

export function isShareExpired(
  share: Pick<ShareLink, "expiresAt">,
  now: Date = new Date(),
): boolean {
  return share.expiresAt != null && share.expiresAt.getTime() <= now.getTime();
}

export function isShareViewExhausted(
  share: Pick<ShareLink, "maxViews" | "viewCount">,
): boolean {
  return share.maxViews != null && share.viewCount >= share.maxViews;
}

/** Outcome of resolving a share token for a specific viewer. */
export type ShareResolveResult =
  | { status: "granted"; share: ShareWithProject; consumed: boolean }
  | { status: "not_found" }
  | { status: "sharing_disabled" }
  | { status: "expired" }
  | { status: "exhausted" }
  | { status: "forbidden" };

export interface ShareViewer {
  /** Already holds a valid grant for this share id (in-window refresh). */
  grantedShareId?: string | null;
  isOrgMember: (organizationId: string) => Promise<boolean>;
  isProjectMember: (projectId: string) => Promise<boolean>;
}

export class ShareService {
  constructor(
    private readonly repo: ShareRepository,
    private readonly pinnedTraces: PinnedTraceService,
  ) {}

  async getById(id: string): Promise<ShareWithProject | null> {
    const share = await this.repo.findById(id);
    if (share?.resourceType === "TRACE" && !share.project.traceSharingEnabled) {
      return null;
    }
    return share;
  }

  async listForResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<ShareLink[]> {
    return this.repo.listByResource(params);
  }

  /**
   * Non-consuming lookup by token for rendering the share page's project
   * chrome. Returns a share only when it currently resolves (exists, sharing
   * enabled, not expired); audience and view-cap are enforced by
   * `resolveForViewer`, which is what actually grants data access.
   */
  async getShareableByToken(token: string): Promise<ShareWithProject | null> {
    const share = await this.repo.findByToken(token);
    if (!share) return null;
    if (share.resourceType === "TRACE" && !share.project.traceSharingEnabled) {
      return null;
    }
    if (isShareExpired(share)) return null;
    return share;
  }

  /**
   * Resolve a share token for a viewer. This is the single authorization point
   * for anonymous reads: the token — not the resource id — is the capability.
   * On success a view is consumed (unless the viewer already holds a grant for
   * this share, i.e. an in-window page refresh), and the caller is expected to
   * mint a scoped grant from the returned share.
   */
  async resolveForViewer({
    token,
    viewer,
  }: {
    token: string;
    viewer: ShareViewer;
  }): Promise<ShareResolveResult> {
    const share = await this.repo.findByToken(token);
    if (!share) return { status: "not_found" };

    if (share.resourceType === "TRACE" && !share.project.traceSharingEnabled) {
      return { status: "sharing_disabled" };
    }

    if (isShareExpired(share)) return { status: "expired" };

    const audienceOk = await this.checkAudience(share, viewer);
    if (!audienceOk) return { status: "forbidden" };

    // In-window refresh: the viewer already spent their view for this share, so
    // the page's several data calls and reloads within the grant window don't
    // re-consume. One view == one grant issuance.
    if (viewer.grantedShareId === share.id) {
      return { status: "granted", share, consumed: false };
    }

    if (isShareViewExhausted(share)) return { status: "exhausted" };

    await this.repo.incrementViewCount({
      id: share.id,
      projectId: share.projectId,
    });
    return { status: "granted", share, consumed: true };
  }

  private async checkAudience(
    share: ShareWithProject,
    viewer: ShareViewer,
  ): Promise<boolean> {
    const visibility: ShareVisibility = share.visibility;
    switch (visibility) {
      case "PUBLIC":
        return true;
      case "ORGANIZATION":
        return viewer.isOrgMember(share.project.team.organizationId);
      case "PROJECT":
        return viewer.isProjectMember(share.projectId);
      default:
        return false;
    }
  }

  async createShare({
    projectId,
    resourceType,
    resourceId,
    threadId,
    visibility,
    expiresAt,
    maxViews,
    userId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    threadId?: string | null;
    visibility?: ShareVisibility;
    expiresAt?: Date | null;
    maxViews?: number | null;
    userId?: string | null;
  }): Promise<ShareLink> {
    const share = await this.repo.create({
      token: generateShareToken(),
      projectId,
      resourceType,
      resourceId,
      threadId,
      visibility,
      expiresAt,
      maxViews,
      userId,
    });

    if (resourceType === "TRACE") {
      try {
        // Idempotent (upsert): keeps the trace pinned while it is shared,
        // without clobbering a pre-existing manual pin.
        await this.pinnedTraces.autoPin({ projectId, traceId: resourceId });
      } catch (error) {
        logger.error(
          { projectId, traceId: resourceId, error },
          "Failed to auto-pin trace on share",
        );
        await this.repo.deleteById({ id: share.id, projectId });
        throw error;
      }
    }

    return share;
  }

  /** Revoke a single link. Auto-unpins only when it was the trace's last share. */
  async revokeById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
    const share = await this.repo.findById(id);
    if (!share || share.projectId !== projectId) return;

    await this.repo.deleteById({ id, projectId });

    if (share.resourceType === "TRACE") {
      const stillShared = await this.repo.hasActiveShareForResource({
        projectId,
        resourceType: "TRACE",
        resourceId: share.resourceId,
      });
      if (!stillShared) {
        // Best-effort: the link is already revoked (the user's intent); a
        // failed unpin only leaves an orphan pin annotation, which is logged.
        try {
          await this.pinnedTraces.autoUnpin({
            projectId,
            traceId: share.resourceId,
          });
        } catch (error) {
          logger.error(
            { projectId, traceId: share.resourceId, error },
            "Failed to auto-unpin trace after revoking its last share",
          );
        }
      }
    }
  }

  /** Revoke every link for a resource (thread unshare, kill switch fan-out). */
  async unshare({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<void> {
    // Auto-unpin first so a failure leaves the shares intact (consistent with
    // createShare rollback).
    if (resourceType === "TRACE") {
      try {
        await this.pinnedTraces.autoUnpin({ projectId, traceId: resourceId });
      } catch (error) {
        logger.error(
          { projectId, traceId: resourceId, error },
          "Failed to auto-unpin trace on unshare",
        );
        throw error;
      }
    }

    await this.repo.deleteByResource({ projectId, resourceType, resourceId });
  }

  async revokeAllTraceShares(projectId: string): Promise<void> {
    // Mirror single `unshare`: drive auto-unpin per trace before deletion so
    // `source=share` pins disappear with their share. Manual pins survive
    // because `autoUnpin` skips traces with a manual pin. Without this loop,
    // disabling trace sharing left orphaned share-sourced pins behind.
    const traceIds = await this.repo.findAllTraceShareResourceIds(projectId);
    for (const traceId of traceIds) {
      try {
        await this.pinnedTraces.autoUnpin({ projectId, traceId });
      } catch (error) {
        logger.error(
          { projectId, traceId, error },
          "Failed to auto-unpin trace during bulk revoke; continuing with remaining traces",
        );
      }
    }
    await this.repo.deleteAllTraceShares(projectId);
  }
}
