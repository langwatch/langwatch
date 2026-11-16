/**
 * Who holds a stored object and until when (ADR-002 §2). One link per owner
 * per object; `retainUntil` only ever moves later. Every read carries the tenant.
 */
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

export type StoredObjectOwnerLink = Readonly<{
  tenantId: StoredObjectProjectId;
  objectId: StoredObjectId;
  ownerKind: string;
  ownerId: string;
  /** When the owner stops holding the object; `null` holds it with no end. */
  retainUntil: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}>;

export interface StoredObjectOwnerLinkRepository {
  /** Writes the link, or moves an existing link's `retainUntil` later; never earlier. */
  raise(link: StoredObjectOwnerLink): Promise<void>;

  /** How many owners still hold the object at `now`. */
  countLive(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): Promise<number>;

  /** Removes every link the tenant holds; a tenant with none is not an error. */
  deleteForTenant(input: { tenantId: StoredObjectProjectId }): Promise<void>;
}
