import {
  mintStoredObjectUri,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import type { StoredObjectStorageAddress } from "@langwatch/stored-object-server";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
import type { StorageRegistry } from "~/server/stored-objects/storage-registry";

export type AppUserAvatarStorageTarget = Readonly<{
  registry: StorageRegistry;
  address: StoredObjectStorageAddress;
  uri: string;
}>;

/** Complete technical boundary for resolving app-owned avatar storage. */
export abstract class AppUserAvatarStorageInfrastructurePort {
  abstract prepareWrite(input: {
    projectId: string;
    objectId: string;
  }): Promise<AppUserAvatarStorageTarget>;

  abstract resolveStored(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): AppUserAvatarStorageTarget;
}

/** Preserves provider selection and credential resolution on every operation. */
export class AppUserAvatarStorageInfrastructureAdapter extends AppUserAvatarStorageInfrastructurePort {
  static create(): AppUserAvatarStorageInfrastructureAdapter {
    return new AppUserAvatarStorageInfrastructureAdapter();
  }

  private constructor() {
    super();
  }

  async prepareWrite(input: {
    projectId: string;
    objectId: string;
  }): Promise<AppUserAvatarStorageTarget> {
    const destination = await resolveProjectStorageDestination(input.projectId);
    const address = addressFor({
      destination,
      relativeId: `${input.projectId}/${input.objectId}`,
    });
    return this.resolveStored({ projectId: input.projectId, address });
  }

  resolveStored(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): AppUserAvatarStorageTarget {
    return {
      registry: createStorageRegistry({ projectId: input.projectId }),
      address: input.address,
      uri: uriFor(input.address),
    };
  }
}

function addressFor(input: {
  destination: StoredObjectStorageDestination;
  relativeId: string;
}): StoredObjectStorageAddress {
  switch (input.destination.kind) {
    case "s3":
      return {
        provider: "s3",
        destinationId: input.destination.bucket,
        relativeId: input.relativeId,
      };
    case "file":
      return {
        provider: "file",
        destinationId: input.destination.root,
        relativeId: input.relativeId,
      };
    case "azure":
      return {
        provider: "azure-blob",
        destinationId: `${input.destination.accountName}/${input.destination.container}`,
        relativeId: input.relativeId,
      };
  }
}

function uriFor(address: StoredObjectStorageAddress): string {
  const relativeId = validatedRelativeId(address.relativeId);
  switch (address.provider) {
    case "s3":
      return mintStoredObjectUri({
        destination: { kind: "s3", bucket: nonEmptyAddressSegment(address.destinationId) },
        objectPath: relativeId,
      });
    case "file":
      return mintStoredObjectUri({
        destination: { kind: "file", root: nonEmptyAddressSegment(address.destinationId) },
        objectPath: relativeId,
      });
    case "azure-blob": {
      const [accountName, container, ...unexpected] = address.destinationId.split("/");
      if (!accountName || !container || unexpected.length > 0) {
        throw new Error("Stored Object Azure address is invalid");
      }
      return mintStoredObjectUri({
        destination: { kind: "azure", accountName, container },
        objectPath: relativeId,
      });
    }
    default:
      throw new Error(`Stored Object provider "${address.provider}" is unsupported`);
  }
}

function nonEmptyAddressSegment(value: string): string {
  if (value.trim().length === 0 || value.includes("\u0000")) {
    throw new Error("Stored Object storage address is invalid");
  }
  return value;
}

function validatedRelativeId(value: string): string {
  const parts = value.split("/");
  if (
    parts.length === 0 ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error("Stored Object relative address is invalid");
  }
  return value;
}
