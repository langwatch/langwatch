import {
  type DeleteProjectStoredObjectsResult,
  type DeleteStoredObjectInput,
  type StoredObjectId,
  type StoredObjectsDeleteOutput,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

import type {
  StoredObjectBytesRepository,
  StoredObjectStorageAddress,
} from "../repositories/stored-object-bytes.repository.ts";
import type { StoredObjectOwnerLinkRepository } from "../repositories/stored-object-owner-link.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { StoredObjectUploadReapService } from "./stored-object-upload-reap.service.ts";

type StoredObjectCleanupOptions = Readonly<{
  records: StoredObjectRecordRepository;
  ownerLinks: StoredObjectOwnerLinkRepository;
  storage: StoredObjectBytesRepository;
  /** The one logical delete; project purges and retries go through it. */
  deleteObject: (input: DeleteStoredObjectInput) => Promise<StoredObjectsDeleteOutput>;
  cleanupBatchSize?: number | undefined;
  now: () => Instant;
}>;

/** Bulk deletion and bounded retries over the object records and their bytes. */
export class StoredObjectCleanupService {
  static create(options: StoredObjectCleanupOptions): StoredObjectCleanupService {
    return new StoredObjectCleanupService(options);
  }

  private readonly uploads: StoredObjectUploadReapService;

  private constructor(private readonly options: StoredObjectCleanupOptions) {
    this.uploads = StoredObjectUploadReapService.create({
      records: options.records,
      storage: options.storage,
      batchSize: options.cleanupBatchSize,
      now: options.now,
    });
  }

  async deleteOwnedBy(input: { projectId: string }): Promise<DeleteProjectStoredObjectsResult> {
    let afterId: StoredObjectId | undefined;
    let deletedObjectCount = 0;
    let deletedByteLength = 0;
    const limit = this.options.cleanupBatchSize ?? 100;
    let isFullPage: boolean;
    do {
      const query: {
        tenantId: string;
        afterId?: StoredObjectId;
        limit: number;
      } = {
        tenantId: input.projectId,
        limit,
      };
      if (afterId) {
        query.afterId = afterId;
      }

      const page = await this.options.records.findPage(query);
      for (const value of page) {
        if (value.status !== "deleted") {
          await this.options.deleteObject({
            projectId: input.projectId,
            id: value.id,
            idempotencyKey: `project-delete:${input.projectId}:${value.id}`,
          });
          deletedObjectCount += 1;
          deletedByteLength += value.byteLength;
        }
      }

      isFullPage = page.length >= limit;
      afterId = page.at(-1)?.id;
    } while (isFullPage && afterId);
    await this.options.ownerLinks.deleteForTenant({ tenantId: input.projectId });

    return {
      projectId: input.projectId,
      deletedObjectCount,
      deletedByteLength,
      status: "completed",
    };
  }

  /** Bounded retry for expired pending uploads; the worker's reaper runs the same pass. */
  async cleanupExpiredUploads(input: { projectId: string; limit?: number }): Promise<number> {
    return this.uploads.reapProject(input);
  }

  /** Bounded retry for provider deletion after logical deletion won. */
  async cleanupDeletedObjects(input: { projectId: string; limit?: number }): Promise<number> {
    const page = await this.options.records.findPage({
      tenantId: input.projectId,
      status: "deleted",
      limit: input.limit ?? this.options.cleanupBatchSize ?? 100,
    });
    let cleaned = 0;
    for (const value of page) {
      if (await this.removeBytesOf(value)) cleaned += 1;
    }

    return cleaned;
  }

  /**
   * Removes a deleted row's bytes, then clears its address only while the row is still
   * that deleted row; answers whether the bytes went.
   */
  async removeBytesOf(value: StoredObjectRecord): Promise<boolean> {
    const address = value.storage;
    if (!address) return false;
    if (!(await this.deleteStorageBestEffort({ projectId: value.tenantId, address }))) return false;

    await this.options.records.transition({
      expected: value,
      next: { ...value, storage: null, expiresAt: null, updatedAt: this.options.now() },
    });

    return true;
  }

  async deleteStorageBestEffort(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<boolean> {
    try {
      await this.options.storage.delete(input);

      return true;
    } catch {
      return false;
    }
  }
}
