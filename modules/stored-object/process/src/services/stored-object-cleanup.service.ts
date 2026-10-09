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
import type { StoredObjectRecordRepository } from "../repositories/stored-object-record.repository.ts";

type StoredObjectCleanupOptions = Readonly<{
  records: StoredObjectRecordRepository;
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

  private constructor(private readonly options: StoredObjectCleanupOptions) {}

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

    return {
      projectId: input.projectId,
      deletedObjectCount,
      deletedByteLength,
      status: "completed",
    };
  }

  /** Bounded retry for pending uploads that have expired. */
  async cleanupExpiredUploads(input: { projectId: string; limit?: number }): Promise<number> {
    const now = this.options.now();
    const page = await this.options.records.findPage({
      tenantId: input.projectId,
      status: "pending",
      expiresBefore: now,
      limit: input.limit ?? this.options.cleanupBatchSize ?? 100,
    });
    let cleaned = 0;
    for (const value of page) {
      if (
        value.storage &&
        !(await this.deleteStorageBestEffort({
          projectId: input.projectId,
          address: value.storage,
        }))
      ) {
        continue;
      }

      await this.options.records.upsert({
        ...value,
        status: "failed",
        storage: null,
        updatedAt: now,
      });
      cleaned += 1;
    }

    return cleaned;
  }

  /** Bounded retry for provider deletion after logical deletion won. */
  async cleanupDeletedObjects(input: { projectId: string; limit?: number }): Promise<number> {
    const now = this.options.now();
    const page = await this.options.records.findPage({
      tenantId: input.projectId,
      status: "deleted",
      limit: input.limit ?? this.options.cleanupBatchSize ?? 100,
    });
    let cleaned = 0;
    for (const value of page) {
      if (!value.storage) {
        continue;
      }

      if (
        !(await this.deleteStorageBestEffort({
          projectId: input.projectId,
          address: value.storage,
        }))
      ) {
        continue;
      }

      await this.options.records.upsert({
        ...value,
        storage: null,
        updatedAt: now,
      });
      cleaned += 1;
    }

    return cleaned;
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
