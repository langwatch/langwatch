import type {
  StoredObjectMetadata,
  StoredObjectReference,
} from "@langwatch/stored-object-contract";
import type { StoredObjectRecord } from "../stores/stored-object.store.ts";

/** The stored object as a caller reads it: facts only, every timestamp already a string. */
export function storedObjectMetadataOf(value: StoredObjectRecord): StoredObjectMetadata {
  const result: StoredObjectMetadata = {
    projectId: value.tenantId,
    id: value.id,
    sha256: value.sha256,
    byteLength: value.byteLength,
    mediaType: value.mediaType,
    mediaTypeVerified: value.mediaTypeVerified,
    status: value.status,
    audiences: [...value.audiences],
    generation: value.generation,
    provenance: {
      purpose: value.purpose,
      ownerKind: value.ownerKind,
      ownerId: value.ownerId,
    },
    createdAt: value.createdAt.toISOString(),
  };
  if (value.availableAt) {
    result.availableAt = value.availableAt.toISOString();
  }

  if (value.deletedAt) {
    result.deletedAt = value.deletedAt.toISOString();
  }

  return result;
}

/** The short handle a writer hands back: enough to fetch the object, nothing about its state. */
export function storedObjectReferenceOf(value: StoredObjectRecord): StoredObjectReference {
  return {
    projectId: value.tenantId,
    id: value.id,
    sha256: value.sha256,
    byteLength: value.byteLength,
    filename: value.filename,
    mediaType: value.mediaType,
    audience: value.audiences[0] ?? "project:view",
  };
}
