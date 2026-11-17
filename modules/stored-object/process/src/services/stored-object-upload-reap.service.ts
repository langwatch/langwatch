import { createLogger } from "@langwatch/observability";
import type { StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type { StoredObjectBytesRepository } from "../repositories/stored-object-bytes.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { movedOn } from "../rules/stored-object-lifecycle.rules.ts";

const logger = createLogger("langwatch:stored-object:upload-reap");

/** Rows cleaned per project, and projects read per page, in one pass. */
const DEFAULT_BATCH_SIZE = 100;
/** Pages of projects one pass walks; what is left waits for the next wake. */
const MAX_PROJECT_PAGES = 10;

type StoredObjectUploadReapOptions = Readonly<{
  records: StoredObjectRecordRepository;
  storage: StoredObjectBytesRepository;
  batchSize?: number | undefined;
  now?: () => Instant;
}>;

/** Pending uploads nobody confirmed: their bytes are deleted and the row is marked failed. */
export class StoredObjectUploadReapService {
  static create(options: StoredObjectUploadReapOptions): StoredObjectUploadReapService {
    return new StoredObjectUploadReapService(options);
  }

  private readonly now: () => Instant;
  private readonly batchSize: number;

  private constructor(private readonly options: StoredObjectUploadReapOptions) {
    this.now = options.now ?? nowInstant;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /** One bounded pass over every project holding an expired pending upload; answers rows reaped. */
  async reap(): Promise<number> {
    const expiresBefore = this.now();
    let afterTenantId: StoredObjectProjectId | undefined;
    let reaped = 0;
    for (let page = 0; page < MAX_PROJECT_PAGES; page += 1) {
      const projects = await this.options.records.findTenantsWithExpiredUploads({
        expiresBefore,
        ...(afterTenantId ? { afterTenantId } : {}),
        limit: this.batchSize,
      });
      for (const projectId of projects) reaped += await this.reapProject({ projectId });
      if (projects.length < this.batchSize) break;
      afterTenantId = projects.at(-1);
    }

    return reaped;
  }

  /** One page of a project's expired uploads; a row whose bytes would not delete waits. */
  async reapProject(input: { projectId: string; limit?: number }): Promise<number> {
    const now = this.now();
    const page = await this.options.records.findPage({
      tenantId: input.projectId,
      status: ["pending", "uploading"],
      expiresBefore: now,
      limit: input.limit ?? this.batchSize,
    });
    let reaped = 0;
    for (const value of page) {
      if (await this.reapOne({ value, now })) reaped += 1;
    }

    return reaped;
  }

  /** Claims the row as failed before touching bytes, so a racing confirm cannot also win. */
  private async reapOne({
    value,
    now,
  }: {
    value: StoredObjectRecord;
    now: Instant;
  }): Promise<boolean> {
    const claimed = movedOn(value, now, { status: "failed" });
    if (!(await this.options.records.transition({ expected: value, next: claimed }))) return false;

    const address = claimed.storage;
    if (address) {
      try {
        await this.options.storage.delete({ projectId: value.tenantId, address });
      } catch (error) {
        logger.warn(
          {
            projectId: value.tenantId,
            objectId: value.id,
            error: error instanceof Error ? error.name : "unknown",
          },
          "expired upload's bytes would not delete; left for the next reap",
        );
        // Bytes still held: hand the row back so the next wake retries it.
        await this.options.records.transition({
          expected: claimed,
          next: movedOn(claimed, now, { status: value.status }),
        });
        return false;
      }
    }

    await this.options.records.transition({
      expected: claimed,
      next: movedOn(claimed, now, { storage: null }),
    });
    return true;
  }
}
