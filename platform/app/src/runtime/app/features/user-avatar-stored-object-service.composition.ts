import type {
  StoredObjectId,
  StoredObjectProjectId,
  StoredObjectService as StoredObjectServiceContract,
} from "@langwatch/stored-object-contract";
import {
  PostgresStoredObjectAdapter,
  StoredObjectDeliveryPort,
  StoredObjectService as CanonicalStoredObjectService,
  StoredObjectStoragePort,
  StoredObjectUploadTokenPort,
} from "@langwatch/stored-object-server";
import { USER_AVATAR_MAX_BYTES } from "@langwatch/user-contract";
import type { PrismaClient } from "~/generated/prisma/client";

class AppStoredObjectIdDeriver {
  fromDigest(input: { projectId: StoredObjectProjectId; sha256: string }): StoredObjectId {
    return input.sha256;
  }
}

class AppUnavailableStoredObjectDeliveryPort extends StoredObjectDeliveryPort {
  async mint(): Promise<never> {
    throw new Error("Stored Object delivery is not composed for the avatar vertical");
  }
}

class AppUnavailableStoredObjectUploadTokenPort extends StoredObjectUploadTokenPort {
  async encode(): Promise<never> {
    throw new Error("Stored Object direct upload is not composed for the avatar vertical");
  }

  async decode(): Promise<never> {
    throw new Error("Stored Object direct upload is not composed for the avatar vertical");
  }
}

/**
 * Composes only the canonical service capabilities used by the authenticated
 * User avatar vertical. Delivery and direct upload remain unavailable.
 */
export function createProcessUserAvatarStoredObjectService(input: {
  database: PrismaClient;
  storage: StoredObjectStoragePort;
}): StoredObjectServiceContract {
  return CanonicalStoredObjectService.create({
    store: PostgresStoredObjectAdapter.create(input.database),
    storage: input.storage,
    delivery: new AppUnavailableStoredObjectDeliveryPort(),
    uploadTokens: new AppUnavailableStoredObjectUploadTokenPort(),
    idDeriver: new AppStoredObjectIdDeriver(),
    maximumUploadBytes: USER_AVATAR_MAX_BYTES,
    uploadExpiryMs: 5 * 60 * 1000,
  });
}
