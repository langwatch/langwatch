/**
 * The canonical stored-object row, as its readers see it. One row per object
 * per tenant; `tenantId` IS the project, and every read carries it.
 */
import type {
  StoredObjectDeliveryAudience,
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

import type { StoredObjectStorageAddress } from "./stored-object-bytes.repository.ts";

export type StoredObjectSource = "canonical" | "imported";

/** The row's status: the lifecycle callers read, plus bytes still streaming through the process. */
export type StoredObjectRecordStatus = StoredObjectLifecycleStatus | "uploading";

export type StoredObjectRecord = Readonly<{
  tenantId: StoredObjectProjectId;
  id: StoredObjectId;
  status: StoredObjectRecordStatus;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  filename: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  mediaTypeVerified: boolean;
  storage: StoredObjectStorageAddress | null;
  generation: number;
  audiences: readonly StoredObjectDeliveryAudience[];
  expiresAt: Instant | null;
  availableAt: Instant | null;
  deletedAt: Instant | null;
  source: StoredObjectSource;
  legacyFingerprint: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}>;

export type StoredObjectRecordPageQuery = Readonly<{
  tenantId: StoredObjectProjectId;
  afterId?: StoredObjectId;
  status?: StoredObjectRecordStatus | readonly StoredObjectRecordStatus[];
  purpose?: string;
  expiresBefore?: Instant;
  limit: number;
}>;

export interface StoredObjectRecordRepository {
  findById(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null>;

  upsert(value: StoredObjectRecord): Promise<void>;

  /** Writes `value` only where no row holds its id yet; false when one already does. */
  insert(value: StoredObjectRecord): Promise<boolean>;

  /** Writes `next` only while the row still holds `expected`'s status and generation. */
  transition(input: {
    expected: Pick<StoredObjectRecord, "status" | "generation">;
    next: StoredObjectRecord;
  }): Promise<boolean>;

  countActive(input: {
    tenantId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<{ activeObjectCount: number; activeByteLength: number }>;

  findPage(input: StoredObjectRecordPageQuery): Promise<StoredObjectRecord[]>;

  /** Up to `limit` available rows with these bytes for one purpose and media type, oldest first. */
  findReusable(input: {
    tenantId: StoredObjectProjectId;
    purpose: string;
    sha256: string;
    mediaType: string;
    limit: number;
  }): Promise<StoredObjectRecord[]>;

  /** Rows of one purpose across every tenant, ordered by tenant then id, after the cursor. */
  findPageByPurpose(input: {
    purpose: string;
    after?: Readonly<{ tenantId: StoredObjectProjectId; id: StoredObjectId }>;
    limit: number;
  }): Promise<StoredObjectRecord[]>;

  /** Projects with an expired open upload or leftover bytes, after the cursor, any tenant. */
  findTenantsWithExpiredUploads(input: {
    expiresBefore: Instant;
    afterTenantId?: StoredObjectProjectId;
    limit: number;
  }): Promise<StoredObjectProjectId[]>;

  /** Removes the row; a row that is not there is not an error. */
  delete(input: { tenantId: StoredObjectProjectId; id: StoredObjectId }): Promise<void>;

  /**
   * Logically deletes and expires an available row no owner link holds at `now` in one
   * statement, so a link landing first keeps it (ADR-002 §4) and the reaper retries its
   * bytes. Answers whether it deleted.
   */
  markDeletedIfUnheld(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    now: Instant;
  }): Promise<boolean>;

  /** Adds the audience to an available row that lacks it; any other row is left as it is. */
  addAudience(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    at: Instant;
  }): Promise<void>;
}
