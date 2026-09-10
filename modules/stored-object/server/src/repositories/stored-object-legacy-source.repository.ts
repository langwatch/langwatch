import type { Instant } from "@langwatch/time";

export type LegacyStoredObjectRow = Readonly<{
  id: string;
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  storageUri: string;
  createdAt: Instant;
  insertedAt: Instant;
}>;

/** Pages through the legacy stored-object rows one project still holds. */
export abstract class StoredObjectLegacySourcePort {
  abstract findPage(input: {
    projectId: string;
    afterId?: string;
    limit: number;
  }): Promise<ReadonlyArray<LegacyStoredObjectRow>>;
}
