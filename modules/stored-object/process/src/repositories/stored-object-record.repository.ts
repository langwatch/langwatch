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

export type StoredObjectRecord = Readonly<{
  tenantId: StoredObjectProjectId;
  id: StoredObjectId;
  status: StoredObjectLifecycleStatus;
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
  status?: StoredObjectLifecycleStatus;
  expiresBefore?: Instant;
  limit: number;
}>;

export interface StoredObjectRecordRepository {
  findById(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null>;

  upsert(value: StoredObjectRecord): Promise<void>;

  countActive(input: {
    tenantId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<{ activeObjectCount: number; activeByteLength: number }>;

  findPage(input: StoredObjectRecordPageQuery): Promise<StoredObjectRecord[]>;

  /** Rows of one purpose across every tenant, ordered by tenant then id, after the cursor. */
  findPageByPurpose(input: {
    purpose: string;
    after?: Readonly<{ tenantId: StoredObjectProjectId; id: StoredObjectId }>;
    limit: number;
  }): Promise<StoredObjectRecord[]>;

  /** Removes the row; a row that is not there is not an error. */
  delete(input: { tenantId: StoredObjectProjectId; id: StoredObjectId }): Promise<void>;
}
