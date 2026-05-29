import type { PublicShare } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import type {
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./repositories/share.repository";

const logger = createLogger("langwatch:share-service");

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

  async getStateForResource(params: {
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<PublicShare | null> {
    return this.repo.findByResourceType(params);
  }

  async createShare({
    projectId,
    resourceType,
    resourceId,
    userId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    userId?: string | null;
  }): Promise<PublicShare> {
    const existing = await this.repo.findByResource({
      projectId,
      resourceType,
      resourceId,
    });
    const share =
      existing ??
      (await this.repo.create({ projectId, resourceType, resourceId, userId }));
    const createdShare = !existing;

    if (resourceType === "TRACE") {
      try {
        await this.pinnedTraces.autoPin({ projectId, traceId: resourceId });
      } catch (error) {
        logger.error(
          { projectId, traceId: resourceId, error },
          "Failed to auto-pin trace on share",
        );
        if (createdShare) {
          await this.repo.deleteByResource({
            projectId,
            resourceType,
            resourceId,
          });
        }
        throw error;
      }
    }

    return share;
  }

  async unshare({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<void> {
    // Auto-unpin first so a failure leaves the share intact (consistent with createShare rollback).
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
    await this.repo.deleteAllTraceShares(projectId);
  }
}
