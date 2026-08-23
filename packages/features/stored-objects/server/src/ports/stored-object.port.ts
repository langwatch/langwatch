import type {
  StoredObjectByteStream,
  StoredObjectDeliveryAudience,
  StoredObjectDeliveryCapability,
  StoredObjectDirectUploadTarget,
  StoredObjectId,
  StoredObjectOperationId,
  StoredObjectProjectId,
  StoredObjectReference,
} from "@langwatch/stored-objects-contract";

export type StoredObjectStorageAddress = Readonly<{
  provider: string;
  destinationId: string;
  relativeId: string;
}>;

export type StoredObjectUploadTokenClaims = Readonly<{
  projectId: StoredObjectProjectId;
  objectId: StoredObjectId;
  operationId: StoredObjectOperationId;
  address: StoredObjectStorageAddress;
  reference: StoredObjectReference;
  expiresAt: string;
}>;

/** Existing application storage drivers are adapted to this narrow boundary. */
export abstract class StoredObjectStoragePort {
  abstract write(input: {
    projectId: StoredObjectProjectId;
    objectId: StoredObjectId;
    bytes: Uint8Array;
    mediaType: string;
  }): Promise<StoredObjectStorageAddress>;

  abstract createUpload(input: {
    projectId: StoredObjectProjectId;
    objectId: StoredObjectId;
    byteLength: number;
    sha256: string;
    mediaType: string;
    expiresAt: Date;
  }): Promise<{
    address: StoredObjectStorageAddress;
    target: StoredObjectDirectUploadTarget;
  } | null>;

  abstract stat(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<{ byteLength: number; sha256: string } | null>;

  abstract read(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<StoredObjectByteStream | null>;

  abstract delete(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<void>;
}

export abstract class StoredObjectUploadTokenPort {
  abstract encode(claims: StoredObjectUploadTokenClaims): Promise<string>;
  abstract decode(token: string): Promise<StoredObjectUploadTokenClaims>;
}

export abstract class StoredObjectDeliveryPort {
  abstract mint(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    generation: number;
  }): Promise<StoredObjectDeliveryCapability>;
}

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
  createdAt: Date;
  insertedAt: Date;
}>;

export abstract class StoredObjectProjectSourcePort {
  abstract listForOrganization(input: {
    organizationId: string;
  }): Promise<ReadonlyArray<{ id: string }>>;
}

export abstract class StoredObjectLegacySourcePort {
  abstract findPage(input: {
    projectId: string;
    afterId?: string;
    limit: number;
  }): Promise<ReadonlyArray<LegacyStoredObjectRow>>;
}

export abstract class StoredObjectLegacyLocationPort {
  abstract parse(input: {
    projectId: string;
    storageUri: string;
  }): Promise<StoredObjectStorageAddress> | StoredObjectStorageAddress;
}

export abstract class StoredObjectLegacyWriterDrainPort {
  abstract get(input: {
    organizationId: string;
  }): Promise<
    | { valid: true; minimumWriterGeneration: string; assertedAt: Date }
    | { valid: false }
  >;
}
