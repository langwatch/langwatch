import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import {
  createShareInputSchema,
  PinnedToActiveShareError,
  resolveShareInputSchema,
  revokeShareInputSchema,
  shareResourceInputSchema,
  sharedPayloadCacheInputSchema,
  ShareService as ShareServiceContract,
  shareViewerSchema,
  tracePinInputSchema,
  type CreateShareInput,
  type ResolveShareInput,
  type RevokeShareInput,
  type ShareLink,
  type ShareResourceInput,
  type SharedPayloadCacheInput,
  type ShareViewer,
  type ShareVisibility,
  type ShareWithProject,
  type TracePinInput,
} from "@langwatch/share-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";
import {
  ShareLinkExhaustedError,
  ShareLinkExpiredError,
  ShareLinkForbiddenError,
  ShareLinkNotFoundError,
  TraceSharingDisabledError,
} from "@langwatch/share-contract";
import type { ShareCacheRepository } from "../repositories/share-cache.repository";
import type { ShareRepository } from "../repositories/share.repository";

const logger = createLogger("langwatch:share-service");
const generateShareToken = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  32,
);

export class ShareService extends ShareServiceContract {
  static create(options: {
    repository: ShareRepository;
    dataRetention: DataRetentionService;
    projects: ProjectService;
    permissions: AuthzService;
    cache: ShareCacheRepository;
  }): ShareService {
    return new ShareService(options);
  }

  private constructor(
    private readonly options: {
      repository: ShareRepository;
      dataRetention: DataRetentionService;
      projects: ProjectService;
      permissions: AuthzService;
      cache: ShareCacheRepository;
    },
  ) {
    super();
  }

  async listForResource(input: ShareResourceInput): Promise<ShareLink[]> {
    const parsed = shareResourceInputSchema.parse(input);
    return this.options.repository.listByResource(parsed);
  }

  /**
   * Resolve the token capability, re-check authorization, then atomically
   * consume one deduplicated viewing without exceeding the view cap.
   */
  async resolveForViewer(input: ResolveShareInput): Promise<ShareWithProject> {
    const { token, viewer, viewerKey } = resolveShareInputSchema.parse(input);
    const share = await this.options.repository.tryFindByToken(token);

    if (!share) {
      throw new ShareLinkNotFoundError();
    }

    // Either kill switch makes the link indistinguishable from a bad token.
    if (
      share.resourceType === "TRACE" &&
      !(share.project.team.organization.traceSharingEnabled && share.project.traceSharingEnabled)
    ) {
      throw new ShareLinkNotFoundError();
    }

    // Audience is checked before expiry so outsiders do not learn link state.
    const audienceOk = await this.checkAudience(share, viewer);
    if (!audienceOk) {
      throw new ShareLinkForbiddenError();
    }

    if (ShareService.isExpired(share)) {
      throw new ShareLinkExpiredError();
    }

    // A deduplicated refresh may reuse the viewing that exhausted the link.
    if (viewerKey) {
      const isNewViewing = await this.options.cache.isNewViewing({
        shareId: share.id,
        viewerKey,
      });

      if (!isNewViewing) {
        return share;
      }
    }

    // The conditional consume remains authoritative under races.
    if (ShareService.isViewExhausted(share)) {
      throw new ShareLinkExhaustedError();
    }

    const consumed = await this.options.repository.consumeView({
      id: share.id,
      projectId: share.projectId,
      maxViews: share.maxViews,
    });

    if (!consumed) {
      throw new ShareLinkExhaustedError();
    }

    return share;
  }

  private async checkAudience(share: ShareWithProject, viewer: ShareViewer): Promise<boolean> {
    const visibility: ShareVisibility = share.visibility;

    switch (visibility) {
      case "PUBLIC":
        return true;
      case "ORGANIZATION":
        return this.hasViewerPermission({
          viewer,
          tier: "organization",
          id: share.project.team.organizationId,
          permission: "organization:view",
        });
      case "PROJECT":
        return this.hasViewerPermission({
          viewer,
          tier: "project",
          id: share.projectId,
          permission: "traces:view",
        });
      default:
        return false;
    }
  }

  private async hasViewerPermission({
    viewer,
    tier,
    id,
    permission,
  }: {
    viewer: ShareViewer;
    tier: "organization" | "project";
    id: string;
    permission: "organization:view" | "traces:view";
  }): Promise<boolean> {
    const parsedViewer = shareViewerSchema.parse(viewer);
    if (parsedViewer.type === "anonymous") {
      return false;
    }

    const decision = await this.options.permissions.getDecision({
      userId: parsedViewer.id,
      permission,
      scope: { tier, id },
    });

    return decision.permitted;
  }

  /** Mint a renderable link after enforcing the project kill switches. */
  async createShare(input: CreateShareInput): Promise<ShareLink> {
    const parsed = createShareInputSchema.parse(input);

    if (parsed.resourceType === "TRACE") {
      const config = await this.options.projects.tryGetTraceSharingConfig(parsed.projectId);
      const enabled = config?.orgEnabled === true && config.projectEnabled;

      if (!enabled) {
        throw new TraceSharingDisabledError();
      }
    }

    const share = await this.options.repository.create({
      token: generateShareToken(),
      ...parsed,
    });

    if (parsed.resourceType === "TRACE") {
      try {
        // Idempotent (upsert): keeps the trace pinned while it is shared,
        // without clobbering a pre-existing manual pin.
        await this.options.dataRetention.autoPin({
          projectId: parsed.projectId,
          traceId: parsed.resourceId,
        });
      } catch (error) {
        logger.warn(
          {
            projectId: parsed.projectId,
            traceId: parsed.resourceId,
            error,
          },
          "Failed to auto-pin trace on share",
        );
        // Roll back the just-created link. Isolate the delete so its failure
        // can't mask the original pin error, and log it — an orphaned live
        // token would otherwise survive silently and stay listable.
        try {
          await this.options.repository.deleteById({
            id: share.id,
            projectId: parsed.projectId,
          });
        } catch (rollbackError) {
          logger.error(
            {
              projectId: parsed.projectId,
              shareId: share.id,
              rollbackError,
            },
            "Failed to roll back share after auto-pin failure; share record is orphaned",
          );
        }
        throw error;
      }
    }

    return share;
  }

  /** Revoke a single link. Auto-unpins only when it was the trace's last share. */
  async revokeById(input: RevokeShareInput): Promise<void> {
    const { id, projectId } = revokeShareInputSchema.parse(input);
    const share = await this.options.repository.tryFindById({ id, projectId });

    if (!share) {
      return;
    }

    await this.options.repository.deleteById({ id, projectId });

    if (share.resourceType === "TRACE") {
      const stillShared = await this.options.repository.hasActiveShareForResource({
        projectId,
        resourceType: "TRACE",
        resourceId: share.resourceId,
      });

      if (!stillShared) {
        // Best-effort: the link is already revoked (the user's intent); a
        // failed unpin only leaves an orphan pin annotation, which is logged.
        try {
          await this.options.dataRetention.autoUnpin({
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
  async unshare(input: ShareResourceInput): Promise<void> {
    const { projectId, resourceType, resourceId } = shareResourceInputSchema.parse(input);

    // Auto-unpin first so a failure leaves the shares intact (consistent with
    // createShare rollback).
    if (resourceType === "TRACE") {
      try {
        await this.options.dataRetention.autoUnpin({
          projectId,
          traceId: resourceId,
        });
      } catch (error) {
        logger.warn(
          { projectId, traceId: resourceId, error },
          "Failed to auto-unpin trace on unshare",
        );
        throw error;
      }
    }

    await this.options.repository.deleteByResource({
      projectId,
      resourceType,
      resourceId,
    });
  }

  async revokeAllTraceShares(projectId: string): Promise<void> {
    // Mirror single `unshare`: drive auto-unpin per trace before deletion so
    // `source=share` pins disappear with their share. Manual pins survive
    // because `autoUnpin` skips traces with a manual pin. Without this loop,
    // disabling trace sharing left orphaned share-sourced pins behind.
    const traceIds = await this.options.repository.findAllTraceShareResourceIds(projectId);

    for (const traceId of traceIds) {
      try {
        await this.options.dataRetention.autoUnpin({ projectId, traceId });
      } catch (error) {
        logger.error(
          { projectId, traceId, error },
          "Failed to auto-unpin trace during bulk revoke; continuing with remaining traces",
        );
      }
    }

    await this.options.repository.deleteAllTraceShares(projectId);
  }

  async unpinTrace(input: TracePinInput): Promise<void> {
    const parsed = tracePinInputSchema.parse(input);
    const isShared = await this.options.repository.hasActiveShareForResource({
      ...parsed,
      resourceType: "TRACE",
      resourceId: parsed.traceId,
    });

    if (isShared) {
      throw new PinnedToActiveShareError(
        "This trace is currently shared. Disable the share before unpinning.",
      );
    }

    await this.options.dataRetention.unpin(parsed);
  }

  async tryGetCachedPayload(input: SharedPayloadCacheInput): Promise<unknown | null> {
    const parsed = sharedPayloadCacheInputSchema.parse(input);
    const key = ShareService.buildPayloadCacheKey(parsed);

    return this.options.cache.tryGetPayload(key);
  }

  async cachePayload(input: SharedPayloadCacheInput & { payload: unknown }): Promise<void> {
    const parsed = sharedPayloadCacheInputSchema.parse({
      token: input.token,
      protections: input.protections,
    });
    const key = ShareService.buildPayloadCacheKey(parsed);

    await this.options.cache.setPayload(key, input.payload);
  }

  static buildPayloadCacheKey({ token, protections }: SharedPayloadCacheInput): string {
    const fingerprint = createHash("sha256")
      .update(ShareService.stableStringify(protections))
      .digest("hex")
      .slice(0, 32);

    return `${token}:${fingerprint}`;
  }

  private static isExpired(share: { expiresAt: Date | null }, now: Date = new Date()): boolean {
    return share.expiresAt != null && share.expiresAt.getTime() <= now.getTime();
  }

  private static isViewExhausted(share: { maxViews: number | null; viewCount: number }): boolean {
    return share.maxViews != null && share.viewCount >= share.maxViews;
  }

  private static stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => ShareService.stableStringify(item)).join(",")}]`;
    }

    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== void 0)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const properties = entries.map(
      ([key, entry]) => `${JSON.stringify(key)}:${ShareService.stableStringify(entry)}`,
    );

    return `{${properties.join(",")}}`;
  }
}
