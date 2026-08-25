import {
  type AuthzPrincipalRef,
  DEFAULT_SHARE_LINK_PERMISSION,
  isShareLinkPermission,
  SHARE_LINK_PERMISSIONS,
  type ShareLinkPermission,
} from "@langwatch/authz";
import { createLogger } from "@langwatch/observability";
import type { ShareLink, ShareVisibility } from "~/generated/prisma/client";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import {
  ShareLinkExhaustedError,
  ShareLinkExpiredError,
  ShareLinkForbiddenError,
  ShareLinkNotFoundError,
  ShareLinkPermissionNotAllowedError,
  TraceSharingDisabledError,
} from "./errors";
import type {
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./repositories/share.repository";
import { generateShareToken } from "./share.token";
import type { ShareAccessDecider } from "./share-access";
import type { ShareViewDedupeService } from "./share-view-dedupe.service";

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

/**
 * The permission a mint asked for, or the refusal. Absent means the default,
 * which is how every existing caller passes through unchanged; anything
 * outside the allowlist is a knowable failure the caller can act on, so it
 * gets a code and the set of values it should have sent.
 */
function assertShareLinkPermission(
  permission: string | null | undefined,
): ShareLinkPermission {
  if (permission == null) return DEFAULT_SHARE_LINK_PERMISSION;
  if (!isShareLinkPermission(permission)) {
    throw new ShareLinkPermissionNotAllowedError(
      Object.keys(SHARE_LINK_PERMISSIONS),
    );
  }
  return permission;
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
   * ADR-092 §8 — the engine, as the ONE authority on whether a presented
   * token authorizes a read. Required, not optional: a share resolve that
   * could fall back to a second implementation of the same rules is exactly
   * what routing this path through the engine removes.
   */
  shareAccess: ShareAccessDecider;
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
   *
   * The DECISION is the engine's (ADR-092 §8). `deps.shareAccess` presents the
   * token at a resource scope and the engine's resource tier answers, which is
   * what makes possession, expiry, the view budget, the audience, the project
   * anchor and the link's own permission ONE implementation rather than two.
   * What is left here is what the engine does not decide:
   *
   *   - the sharing KILL SWITCH, a project/organization setting the resource
   *     tier reads nothing of (see below);
   *   - view ACCOUNTING, which has its own writer and its own atomicity;
   *   - which REFUSAL a denied caller is told, derived from the link this
   *     service already holds. Those predicates explain a denial; they no
   *     longer make one.
   *
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
    principal,
    viewer,
    viewerKey,
  }: {
    token: string;
    /** Who is asking, as the engine names it. No session is `anonymous`. */
    principal: AuthzPrincipalRef;
    viewer: ShareViewer;
    /** Opaque per-viewer key; omit to count every request as a viewing. */
    viewerKey?: string;
  }): Promise<ShareWithProject> {
    const share = await this.repo.findByToken(token);
    if (!share) throw new ShareLinkNotFoundError();

    // Sharing kill switch: effective sharing = org AND project. Off at either
    // level makes every trace link stop resolving — indistinguishable from a
    // bad token by design. See ADR-057.
    //
    // Deliberately still decided here. The switch is a flag on the PROJECT and
    // its ORGANIZATION, and the resource tier reads share rows, not project
    // settings: `ShareLinkRow` carries no such column, so asking the engine
    // would mean inventing a fact for it to collect. It gates the resolve
    // before the engine is consulted, so a killed link costs one read.
    if (
      share.resourceType === "TRACE" &&
      !(
        share.project.team.organization.traceSharingEnabled &&
        share.project.traceSharingEnabled
      )
    ) {
      throw new ShareLinkNotFoundError();
    }

    const access = await this.deps.shareAccess.decide({
      principal,
      // What the read surface asks for. A link minted to confer more (the
      // `annotations:create` option) still satisfies it; one whose stored
      // permission confers less — or names something outside the allowlist —
      // does not, and the reader is refused. That refusal exists only because
      // the engine decides: no hand-rolled check ever read the column.
      permission: DEFAULT_SHARE_LINK_PERMISSION,
      projectId: share.projectId,
      resourceType: share.resourceType,
      resourceId: share.resourceId,
      token,
    });
    if (!access.allowed) {
      return await this.refuse({ share, viewer, viewerKey });
    }

    // The link is live, so a repeat viewing inside the window is a viewing
    // already counted — it must not consume another.
    if (viewerKey && this.deps.viewDedupe) {
      const isNewViewing = await this.deps.viewDedupe.isNewViewing({
        shareId: share.id,
        viewerKey,
      });
      if (!isNewViewing) return share;
    }

    const consumed = await this.repo.consumeView({
      id: share.id,
      projectId: share.projectId,
      maxViews: share.maxViews,
    });
    if (!consumed) throw new ShareLinkExhaustedError();

    return share;
  }

  /**
   * The engine refused. Say WHICH refusal, in the order ADR-057 fixed — and
   * nothing more: these predicates read the link the caller already presented,
   * so none of them tells them anything a possessed token did not.
   *
   * Audience before expiry: an out-of-audience viewer (including an anonymous
   * prober holding a leaked ORGANIZATION/PROJECT token) learns nothing beyond
   * "sign in" — not even that the link expired. Anything the engine refused
   * that these predicates all pass is a link that confers nothing here, and
   * answers with the same generic not-found as an unknown token.
   */
  private async refuse({
    share,
    viewer,
    viewerKey,
  }: {
    share: ShareWithProject;
    viewer: ShareViewer;
    viewerKey?: string;
  }): Promise<ShareWithProject> {
    if (!(await this.checkAudience(share, viewer))) {
      throw new ShareLinkForbiddenError();
    }
    if (isShareExpired(share)) throw new ShareLinkExpiredError();
    if (isShareViewExhausted(share)) {
      // The one refusal that is not final. A viewer re-reading inside the
      // dedupe window must not be locked out by the view THEY consumed — a
      // single-view link has to survive its recipient pressing refresh. The
      // engine cannot express it: the collector filters a spent link out
      // (`isLiveShareLink`) before the walk ever sees the row, and it has no
      // notion of who is re-reading. So the window is honoured here, where the
      // viewing was recorded.
      if (viewerKey && this.deps.viewDedupe) {
        const isNewViewing = await this.deps.viewDedupe.isNewViewing({
          shareId: share.id,
          viewerKey,
        });
        if (!isNewViewing) return share;
      }
      throw new ShareLinkExhaustedError();
    }
    throw new ShareLinkNotFoundError();
  }

  /**
   * Which refusal an out-of-audience viewer gets — NOT whether they are in the
   * audience, which the engine decided above. Kept on the viewer probes the
   * router supplies rather than re-deriving from the decision: the engine
   * hands back one boolean, and a refusal has to pick between "sign in" (401)
   * and "this link is dead" (403) without disclosing which.
   */
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
   *
   * `permission` is what the link confers (ADR-092 §8). Omitted stores
   * nothing, which every reader takes as `traces:view` — so a caller that
   * does not mention it mints the row it minted before the column existed.
   * The allowlist is validated HERE rather than at the router, because the
   * router is not the only way in and a repository stores what it is told.
   */
  async createShare({
    projectId,
    resourceType,
    resourceId,
    visibility,
    expiresAt,
    maxViews,
    userId,
    permission,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    visibility?: ShareVisibility;
    expiresAt?: Date | null;
    maxViews?: number | null;
    userId?: string | null;
    permission?: string | null;
  }): Promise<ShareLink> {
    if (
      resourceType === "TRACE" &&
      !(await this.deps.isTraceSharingEnabled(projectId))
    ) {
      throw new TraceSharingDisabledError();
    }

    const requested = assertShareLinkPermission(permission);

    const share = await this.repo.create({
      token: generateShareToken(),
      projectId,
      resourceType,
      resourceId,
      visibility,
      expiresAt,
      maxViews,
      userId,
      // The default is stored as absence, not as its own name: an ordinary
      // link's row must not start differing from the ones already there.
      ...(requested === DEFAULT_SHARE_LINK_PERMISSION
        ? {}
        : { permission: requested }),
    });

    if (resourceType === "TRACE") {
      try {
        // Idempotent (upsert): keeps the trace pinned while it is shared,
        // without clobbering a pre-existing manual pin.
        await this.pinnedTraces.autoPin({ projectId, traceId: resourceId });
      } catch (error) {
        logger.warn(
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
        logger.warn(
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
