import { createLogger } from "@langwatch/observability";

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
 * Read and reclaim surface for the lane queue's content-addressed blob spool.
 *
 * Every destructive method logs what it removed and who asked. Deleting a
 * payload out from under a staged job is unrecoverable and invisible at the
 * queue level (the job completes without its handler), so the trail has to name
 * the actor — as an opaque user id, never an email; the id is enough to trace
 * an action back through the account without putting PII in the log stream.
 */
export class BlobStoreService {
  constructor(private readonly repo: BlobStoreRepository) {}

  async getBlobs(params: {
    cursor?: string | null;
    limit?: number;
    projectId?: string | null;
    sort?: OpsBlobSort;
  }): Promise<OpsBlobPage> {
    return this.repo.findAll({
      cursor: params.cursor ?? null,
      limit: params.limit ?? DEFAULT_PAGE_SIZE,
      projectId: params.projectId ?? null,
      // Ranked by default: an operator opening this page is looking for what is
      // occupying the instance, and raw cursor order is hash-bucket order.
      sort: params.sort ?? "largest",
    });
  }

  async getBlobById(params: {
    projectId: string;
    hash: string;
  }): Promise<OpsBlobSummary | null> {
    return this.repo.findById(params);
  }

  async getStats(): Promise<OpsBlobStoreStats> {
    return this.repo.findStats({ sampleLimit: STATS_SAMPLE_LIMIT });
  }

  async deleteBlob(params: {
    projectId: string;
    hash: string;
    /** Opaque actor id (never an email) — see the class docstring. */
    requestedBy: string;
  }): Promise<{ deleted: boolean }> {
    // The holder guard is inside the delete script, so there is no
    // read-then-act window here: a blob that gains a holder between inspection
    // and delete is refused by the same eval that would have removed it.
    const result = await this.repo.deleteOne({
      projectId: params.projectId,
      hash: params.hash,
    });

    if (result.refusedHolders > 0) {
      logger.warn(
        {
          projectId: params.projectId,
          blobHash: params.hash,
          holders: result.refusedHolders,
          requestedBy: params.requestedBy,
        },
        "Refused an operator blob delete: a holder still references it",
      );
      return { deleted: false };
    }

    logger.info(
      {
        projectId: params.projectId,
        blobHash: params.hash,
        requestedBy: params.requestedBy,
        deleted: result.deleted,
      },
      "Operator deleted a queue blob",
    );
    return { deleted: result.deleted };
  }
}
