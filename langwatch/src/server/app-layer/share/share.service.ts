import { createLogger } from "@langwatch/observability";
import type { ShareLink, ShareVisibility } from "@prisma/client";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import type {
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./repositories/share.repository";
import type { ShareLifecycleLocker } from "./share.lifecycleLock";
import { generateShareToken } from "./share.token";
import {
  type ShareGrantClaims,
  ShareGrantExpiredError,
  signShareGrant,
} from "./shareGrant";

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
  | {
      status: "granted";
      share: ShareWithProject;
      isConsumed: boolean;
      grant: ReturnType<typeof signShareGrant>;
    }
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

export type ShareAudienceViewer = Pick<
  ShareViewer,
  "isOrgMember" | "isProjectMember"
>;

export type PublicShareProjectResult =
  | { status: "granted"; project: PublicShareProject }
  | { status: "not_found" }
  | { status: "forbidden" };

export interface PublicShareProject {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
}

export interface CreateShareParams {
  projectId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  threadId?: string | null;
  visibility?: ShareVisibility;
  expiresAt?: Date | null;
  maxViews?: number | null;
  userId?: string | null;
}

export class ShareService {
  private readonly repo: ShareRepository;
  private readonly pinnedTraces: PinnedTraceService;
  private readonly lifecycleLocker: ShareLifecycleLocker;

  constructor({
    repo,
    pinnedTraces,
    lifecycleLocker,
  }: {
    repo: ShareRepository;
    pinnedTraces: PinnedTraceService;
    lifecycleLocker: ShareLifecycleLocker;
  }) {
    this.repo = repo;
    this.pinnedTraces = pinnedTraces;
    this.lifecycleLocker = lifecycleLocker;
  }

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
   * Revalidate a signed grant against the live link and the viewer's current
   * audience membership. View exhaustion is intentionally not checked here:
   * issuing a grant may itself consume the link's final allowed view.
   */
  async validateGrantForViewer({
    grant,
    viewer,
  }: {
    grant: ShareGrantClaims;
    viewer: ShareAudienceViewer;
  }): Promise<boolean> {
    const share = await this.repo.findById(grant.share_id);
    if (!share) return false;

    return this.validateGrantAgainstShare({ share, grant, viewer });
  }

  async getPublicProjectForGrant({
    shareId,
    projectId,
    grant,
    viewer,
  }: {
    shareId: string;
    projectId: string;
    grant: ShareGrantClaims | null | undefined;
    viewer: ShareAudienceViewer;
  }): Promise<PublicShareProjectResult> {
    const share = await this.repo.findById(shareId);
    if (
      !share ||
      share.projectId !== projectId ||
      (share.resourceType === "TRACE" && !share.project.traceSharingEnabled) ||
      isShareExpired(share)
    ) {
      return { status: "not_found" };
    }

    if (
      !grant ||
      grant.share_id !== shareId ||
      grant.project_id !== projectId ||
      !(await this.validateGrantAgainstShare({ share, grant, viewer }))
    ) {
      return { status: "forbidden" };
    }

    return {
      status: "granted",
      project: {
        id: share.project.id,
        name: share.project.name,
        slug: share.project.slug,
        language: share.project.language,
        framework: share.project.framework,
      },
    };
  }

  private async validateGrantAgainstShare({
    share,
    grant,
    viewer,
  }: {
    share: ShareWithProject;
    grant: ShareGrantClaims;
    viewer: ShareAudienceViewer;
  }): Promise<boolean> {
    const claimsMatch =
      share.projectId === grant.project_id &&
      share.resourceType === grant.resource_type &&
      share.resourceId === grant.resource_id &&
      share.threadId === grant.thread_id;
    if (!claimsMatch) return false;

    if (share.resourceType === "TRACE" && !share.project.traceSharingEnabled) {
      return false;
    }
    if (isShareExpired(share)) return false;

    return this.checkAudience({ share, viewer });
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

    const isAudienceAllowed = await this.checkAudience({ share, viewer });
    if (!isAudienceAllowed) return { status: "forbidden" };

    // Mint before consuming. If the link crosses its expiry boundary here,
    // no view has been spent. The repository's conditional increment repeats
    // the expiry predicate atomically, so a token that expires between this
    // signing step and the database write is not consumed either.
    let grant: ReturnType<typeof signShareGrant>;
    try {
      grant = signShareGrant(
        {
          share_id: share.id,
          project_id: share.projectId,
          resource_type: share.resourceType,
          resource_id: share.resourceId,
          thread_id: share.threadId,
        },
        share.expiresAt,
      );
    } catch (error) {
      if (error instanceof ShareGrantExpiredError) {
        return { status: "expired" };
      }
      throw error;
    }

    // In-window refresh: the viewer already spent their view for this share, so
    // the page's several data calls and reloads within the grant window don't
    // re-consume. One view == one grant issuance.
    if (viewer.grantedShareId === share.id) {
      return { status: "granted", share, isConsumed: false, grant };
    }

    const isConsumed = await this.repo.incrementViewCount({
      id: share.id,
      projectId: share.projectId,
      maxViews: share.maxViews,
    });

    if (!isConsumed) {
      if (isShareExpired(share)) {
        return { status: "expired" };
      }
      return { status: "exhausted" };
    }
    return { status: "granted", share, isConsumed: true, grant };
  }

  private async checkAudience({
    share,
    viewer,
  }: {
    share: ShareWithProject;
    viewer: ShareAudienceViewer;
  }): Promise<boolean> {
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

  async createShare(params: CreateShareParams): Promise<ShareLink> {
    return this.lifecycleLocker.run({
      projectId: params.projectId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      operation: () => this.createShareWithinLock(params),
    });
  }

  private async createShareWithinLock({
    projectId,
    resourceType,
    resourceId,
    threadId,
    visibility,
    expiresAt,
    maxViews,
    userId,
  }: CreateShareParams): Promise<ShareLink> {
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

    await this.lifecycleLocker.run({
      projectId,
      resourceType: share.resourceType,
      resourceId: share.resourceId,
      operation: () => this.revokeByIdWithinLock({ id, projectId }),
    });
  }

  private async revokeByIdWithinLock({
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
      const isStillShared = await this.repo.hasActiveShareForResource({
        projectId,
        resourceType: "TRACE",
        resourceId: share.resourceId,
      });
      if (!isStillShared) {
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

        const hasReplacement = await this.repo.hasActiveShareForResource({
          projectId,
          resourceType: "TRACE",
          resourceId: share.resourceId,
        });
        if (hasReplacement) {
          await this.pinnedTraces.autoPin({
            projectId,
            traceId: share.resourceId,
          });
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
    await this.lifecycleLocker.run({
      projectId,
      resourceType,
      resourceId,
      operation: () =>
        this.unshareWithinLock({ projectId, resourceType, resourceId }),
    });
  }

  private async unshareWithinLock({
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
