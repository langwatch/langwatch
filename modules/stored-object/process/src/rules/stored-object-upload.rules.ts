import {
  purposePolicyOf,
  type CreateStoredObjectUploadInput,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

import type { StoredObjectStorageAddress } from "../repositories/stored-object-bytes.repository.ts";
import type { StoredObjectRecord } from "../repositories/stored-object-record.repository.ts";

/** The row a signed upload leaves behind while its bytes are still in flight. */
export function pendingUploadRecord({
  input,
  id,
  address,
  expiresAt,
  now,
}: {
  input: CreateStoredObjectUploadInput;
  id: StoredObjectRecord["id"];
  address: StoredObjectStorageAddress;
  expiresAt: Instant;
  now: Instant;
}): StoredObjectRecord {
  return {
    tenantId: input.projectId,
    id,
    status: "pending",
    purpose: input.purpose,
    ownerKind: "project",
    ownerId: input.projectId,
    filename: input.filename,
    sha256: "",
    byteLength: input.byteLength,
    mediaType: input.mediaType,
    mediaTypeVerified: false,
    storage: address,
    generation: 0,
    audiences: [purposePolicyOf(input.purpose).readPermission],
    expiresAt,
    availableAt: null,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}
