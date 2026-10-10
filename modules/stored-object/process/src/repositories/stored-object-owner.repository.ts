export type StoredObjectOwnerHit = Readonly<{
  projectId: string;
  target: string;
}>;

export type StoredObjectOwnerLookupResult = Readonly<{
  hit: StoredObjectOwnerHit | null;
  failedTargets: string[];
  instancesSearched: number;
}>;

export abstract class StoredObjectOwnerRepository {
  abstract findOwner(id: string): Promise<StoredObjectOwnerLookupResult>;
}
