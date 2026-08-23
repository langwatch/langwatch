import type {
  StoredObjectDeliveryAudience,
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-objects-contract";
import type { StoredObjectStorageAddress } from "../ports/stored-object.port";

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
  expiresAt: Date | null;
  availableAt: Date | null;
  deletedAt: Date | null;
  source: StoredObjectSource;
  legacyFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

/** One persistence boundary for the single StoredObject table. */
export abstract class StoredObjectStore {
  abstract find(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null>;

  abstract save(value: StoredObjectRecord): Promise<void>;

  abstract getUsage(input: {
    tenantId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<{ activeObjectCount: number; activeByteLength: number }>;

  abstract findPage(input: {
    tenantId: StoredObjectProjectId;
    afterId?: StoredObjectId;
    status?: StoredObjectLifecycleStatus;
    expiresBefore?: Date;
    limit: number;
  }): Promise<StoredObjectRecord[]>;
}
