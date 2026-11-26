/**
 * Who holds a stored object and until when (ADR-002 §2). One link per owner
 * per object; a store only moves `retainUntil` later, a retention change re-times it
 * (ADR-002 §5). Every read carries the tenant except the sweep's tenant list.
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
  /**
   * Writes the link, or moves an existing link's `retainUntil` later, never earlier, and its
   * `createdAt` with it, so a re-time counts from the owner's latest store (ADR-002 §5).
   */
  raise(link: StoredObjectOwnerLink): Promise<void>;

  /** How many owners have ever linked the object, ended or not; none means it predates links. */
  countAll(input: { tenantId: StoredObjectProjectId; objectId: StoredObjectId }): Promise<number>;

  /** How many owners still hold the object at `now`. */
  countLive(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): Promise<number>;

  /** Removes every link the tenant holds; a tenant with none is not an error. */
  deleteForTenant(input: { tenantId: StoredObjectProjectId }): Promise<void>;

  /** Tenants holding a link that ended at or before `before`, the longest-waiting end first. */
  findTenantsWithExpired(input: {
    before: Instant;
    limit: number;
  }): Promise<StoredObjectProjectId[]>;

  /** One tenant's links that ended at or before `before`, by object, owner kind and owner. */
  findExpired(input: {
    tenantId: StoredObjectProjectId;
    before: Instant;
    limit: number;
  }): Promise<StoredObjectOwnerLink[]>;

  /**
   * Removes these objects' links still ended at `before`; one raised since survives.
   * `keepingLastLink` removes an ended link only while a live link holds the object.
   */
  deleteExpired(input: {
    tenantId: StoredObjectProjectId;
    objectIds: readonly StoredObjectId[];
    before: Instant;
    keepingLastLink?: boolean;
  }): Promise<number>;

  /**
   * Sets every link on these objects to its `createdAt` plus `days`; `null` holds with no end.
   * `onlyLater` keeps a link's end when it is already later, or none.
   */
  retime(input: {
    tenantId: StoredObjectProjectId;
    objectIds: readonly StoredObjectId[];
    days: number | null;
    onlyLater?: boolean;
    at: Instant;
  }): Promise<void>;
}
