import { createLogger } from "@langwatch/observability";

import type { BlobSweepReport } from "~/server/event-sourcing/queues/groupQueue/blobSweeper";

import type { BlobStoreRepository } from "./repositories/blob-store.repository";
import type {
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  OpsBlobSummary,
} from "./types";

const logger = createLogger("langwatch:ops:blob-store");

const DEFAULT_PAGE_SIZE = 50;
const STATS_SAMPLE_LIMIT = 200;

/**
 * Read and reclaim surface for the group queue's content-addressed blob store.
 *
 * Every destructive method logs what it removed. Deleting a payload out from
 * under a staged job is unrecoverable and invisible at the queue level (the job
 * completes without its handler), so an operator-initiated delete has to leave
 * a trail that names who asked for it.
 */
export class BlobStoreService {
  constructor(private readonly repo: BlobStoreRepository) {}

  async getQueueNames(): Promise<string[]> {
    return this.repo.findAllQueueNames();
  }

  async getBlobs(params: {
    queueName: string;
    cursor?: string | null;
    limit?: number;
    projectId?: string | null;
    sort?: OpsBlobSort;
  }): Promise<OpsBlobPage> {
    return this.repo.findAll({
      queueName: params.queueName,
      cursor: params.cursor ?? null,
      limit: params.limit ?? DEFAULT_PAGE_SIZE,
      projectId: params.projectId ?? null,
      // Ranked by default: an operator opening this page is looking for what is
      // occupying the instance, and raw cursor order is hash-bucket order.
      sort: params.sort ?? "largest",
    });
  }

  async getBlobById(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null> {
    return this.repo.findById(params);
  }

  async getStats(): Promise<OpsBlobStoreStats> {
    return this.repo.findStats({ sampleLimit: STATS_SAMPLE_LIMIT });
  }

  async deleteBlob(params: {
    queueName: string;
    projectId: string;
    hash: string;
    requestedBy: string;
  }): Promise<{ deleted: boolean }> {
    const blob = await this.repo.findById(params);
    // Refusing a leased blob is the guard that matters: the sweeper would never
    // touch one, and a hand delete must not be the one path that can.
    if (blob && blob.liveLeases > 0) {
      logger.warn(
        {
          queueName: params.queueName,
          projectId: params.projectId,
          blobHash: params.hash,
          liveLeases: blob.liveLeases,
          requestedBy: params.requestedBy,
        },
        "Refused an operator blob delete: a live lease still references it",
      );
      return { deleted: false };
    }

    const deleted = await this.repo.deleteOne(params);
    logger.info(
      {
        queueName: params.queueName,
        projectId: params.projectId,
        blobHash: params.hash,
        requestedBy: params.requestedBy,
        deleted,
      },
      "Operator deleted a queue blob",
    );
    return { deleted };
  }

  async runCleanup(params: {
    dryRun: boolean;
    requestedBy: string;
  }): Promise<BlobSweepReport> {
    const report = await this.repo.runCleanup({ dryRun: params.dryRun });
    logger.info(
      {
        dryRun: params.dryRun,
        requestedBy: params.requestedBy,
        scanned: report.totals.scanned,
        repaired: report.totals.repaired,
        reclaimed: report.totals.reclaimed,
      },
      "Operator ran a blob cleanup sweep",
    );
    return report;
  }
}
