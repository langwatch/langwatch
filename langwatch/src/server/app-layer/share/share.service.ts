import { createLogger } from "@langwatch/observability";
import type { ShareLink, ShareVisibility } from "@prisma/client";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import {
  ShareLinkExhaustedError,
  ShareLinkExpiredError,
  ShareLinkForbiddenError,
  ShareLinkNotFoundError,
  TraceSharingDisabledError,
} from "./errors";
import type {
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./repositories/share.repository";
import type { ShareViewDedupeService } from "./share-view-dedupe.service";
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

export interface ShareViewer {
  isOrgMember: (organizationId: string) => Promise<boolean>;
  isProjectMember: (projectId: string) => Promise<boolean>;
}

/**
 * Narrow capability lookups injected as functions (the house style for
 * breaking service cycles — see the pinning wiring in presets.ts) so the
 * share domain's guards live HERE, not in routers, without ShareService
 * depending on ProjectService / TraceSummaryService wholesale.
 */
export interface ShareServiceDeps {
  isTraceSharingEnabled: (projectId: string) => Promise<boolean>;
  /**
   * Collapses one viewer's repeat opens of a link into a single viewing, so
   * `maxViews` counts viewings rather than HTTP requests. Absent (tests, no
   * Redis) means every open counts, which is the stricter behaviour.
   */
  viewDedupe?: ShareViewDedupeService;
}

export class ShareService {
  constructor(
    private readonly repo: ShareRepository,
    private readonly pinnedTraces: PinnedTraceService,
    private readonly deps: ShareServiceDeps,
  ) {}

  async listForResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<ShareLink[]> {
    return this.repo.listByResource(params);
  }

  /**
   * Resolve a share token for a viewer. This is the single authorization point
   * for anonymous reads: the token — not the resource id — is the capability.
   * Failures throw typed share HandledErrors (mapped to wire codes by
   * `handledErrorMiddleware`); a token that doesn't resolve and one behind the
   * sharing kill switch are indistinguishable by design. Every successful
   * resolve consumes exactly one view, atomically against the view cap
   * (simultaneous opens of a single-view link admit at most one viewer).
   *
   * "One view" means one *viewing*, not one request: when a `viewerKey` is
   * supplied, the same viewer re-opening the link inside the dedupe window
   * (a refresh, a restored tab) does not consume another. Authorization is
   * still re-evaluated in full every time — only the counting is deduped.
   */
  async resolveForViewer({
    token,
    viewer,
    viewerKey,
  }: {
    token: string;
    viewer: ShareViewer;
    /** Opaque per-viewer key; omit to count every request as a viewing. */
    viewerKey?: string;
  }): Promise<ShareWithProject> {
    const share = await this.repo.findByToken(token);
    if (!share) throw new ShareLinkNotFoundError();

    // Sharing kill switch: effective sharing = org AND project. Off at either
    // level makes every trace link stop resolving — indistinguishable from a
    // bad token by design. See ADR-057.
    if (
      share.resourceType === "TRACE" &&
      !(
        share.project.team.organization.traceSharingEnabled &&
        share.project.traceSharingEnabled
      )
    ) {
      throw new ShareLinkNotFoundError();
    }

    // Audience before expiry: an out-of-audience viewer (including an
    // anonymous prober holding a leaked ORGANIZATION/PROJECT token) learns
    // nothing beyond "sign in" — not even that the link expired.
    const audienceOk = await this.checkAudience(share, viewer);
    if (!audienceOk) throw new ShareLinkForbiddenError();

    if (isShareExpired(share)) throw new ShareLinkExpiredError();

    // Before the exhaustion check, not after: a viewer re-reading inside the
    // window must not be locked out by the view THEY already consumed. That
    // is the whole point — a single-view link should survive its recipient
    // pressing refresh.
    if (viewerKey && this.deps.viewDedupe) {
      const isNewViewing = await this.deps.viewDedupe.isNewViewing({
        shareId: share.id,
        viewerKey,
      });
      if (!isNewViewing) return share;
    }

    // Fast path: an already-spent link answers without attempting a write. The
    // atomic conditional consume below remains the authority under races.
    if (isShareViewExhausted(share)) throw new ShareLinkExhaustedError();

    const consumed = await this.repo.consumeView({
      id: share.id,
      projectId: share.projectId,
      maxViews: share.maxViews,
    });
    if (!consumed) throw new ShareLinkExhaustedError();

    return share;
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

  /**
   * Mint a share link. The kill-switch guard lives here, not in the router.
   *
   * Thread sharing is parked: a THREAD-typed link has no renderable payload
   * (`sharedTrace.get` serves a trace and nothing else), so minting one would
   * hand out a capability nothing can redeem. The `ShareLink.threadId` column
   * stays — unpopulated — for when the aggregate can carry the surrounding
   * conversation. See ADR-057's follow-ups.
   */
  async createShare({
    projectId,
    resourceType,
    resourceId,
    visibility,
    expiresAt,
    maxViews,
    userId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    visibility?: ShareVisibility;
    expiresAt?: Date | null;
    maxViews?: number | null;
    userId?: string | null;
  }): Promise<ShareLink> {
    if (
      resourceType === "TRACE" &&
      !(await this.deps.isTraceSharingEnabled(projectId))
    ) {
      throw new TraceSharingDisabledError();
    }

    const share = await this.repo.create({
      token: generateShareToken(),
      projectId,
      resourceType,
      resourceId,
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
        // Roll back the just-created link. Isolate the delete so its failure
        // can't mask the original pin error, and log it — an orphaned live
        // token would otherwise survive silently and stay listable.
        try {
          await this.repo.deleteById({ id: share.id, projectId });
        } catch (rollbackError) {
          logger.error(
            { projectId, shareId: share.id, rollbackError },
            "Failed to roll back share after auto-pin failure; share record is orphaned",
          );
        }
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
    const share = await this.repo.findById({ id, projectId });
    if (!share) return;

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
