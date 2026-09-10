/**
 * The doubles every stored-object test builds on: an in-process byte backend,
 * a token codec that remembers what it minted, a fixed delivery capability,
 * and the row-and-stream reads the byte surface performs.
 */
import { ResourceScope } from "@langwatch/runtime-composition";
import type {
  StoredObjectDeliveryCapability,
  StoredObjectDirectUploadTarget,
  StoredObjectHead,
  StoredObjectOwnerResolver,
} from "@langwatch/stored-object-contract";
import {
  StoredObjectDelivery,
  StoredObjectStorage,
  StoredObjectUploadTokenCodec,
  type StoredObjectStorageAddress,
  type StoredObjectUploadTokenClaims,
} from "../stored-object.members.ts";
import type { StoredObjectRepositories } from "../../repositories/stored-object.repositories.ts";
import { MemoryStoredObjectRepositories } from "../../repositories/memory/memory.stored-object.repositories.ts";
import {
  StoredObjectApp,
  type StoredObjectFileReader,
  type StoredObjectFileStreamRead,
  type StoredObjectInfrastructure,
} from "../stored-object.app.ts";

export const STORED_OBJECT_TEST_SHA256 = "a".repeat(64);

export const storedObjectTestAddress: StoredObjectStorageAddress = {
  provider: "existing-storage",
  destinationId: "primary",
  relativeId: "project_1/so_aaaaaaaa",
};

export class MemoryStoredObjectStorage extends StoredObjectStorage {
  bytes = new Uint8Array([1, 2, 3]);
  deleted = false;
  deleteFailuresRemaining = 0;

  async write(): Promise<StoredObjectStorageAddress> {
    return storedObjectTestAddress;
  }

  async tryCreateUpload(): Promise<{
    address: StoredObjectStorageAddress;
    target: StoredObjectDirectUploadTarget;
  }> {
    return {
      address: storedObjectTestAddress,
      target: {
        method: "PUT",
        url: "https://storage.example/upload",
        headers: {},
        expiresAt: "2026-08-22T00:05:00.000Z",
      },
    };
  }

  async tryStat() {
    return { byteLength: 3, sha256: STORED_OBJECT_TEST_SHA256 };
  }

  async tryRead() {
    const bytes = this.bytes;

    return (async function* () {
      yield bytes;
    })();
  }

  async delete(): Promise<void> {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error("provider unavailable");
    }
    this.deleted = true;
  }
}

export class MemoryStoredObjectTokens extends StoredObjectUploadTokenCodec {
  claims: StoredObjectUploadTokenClaims | null = null;

  async encode(claims: StoredObjectUploadTokenClaims): Promise<string> {
    this.claims = claims;

    return "token";
  }

  async decode(): Promise<StoredObjectUploadTokenClaims> {
    if (!this.claims) throw new Error("missing token");

    return this.claims;
  }
}

export class FixedStoredObjectDelivery extends StoredObjectDelivery {
  async mint(): Promise<StoredObjectDeliveryCapability> {
    return {
      url: "https://files.example/object",
      expiresAt: "2026-08-22T00:05:00.000Z",
      methods: ["GET", "HEAD"],
      audience: "project:view",
      generation: 1,
    };
  }
}

/** The byte surface's reads, answering "no such row" until a test says otherwise. */
export class MemoryStoredObjectFiles implements StoredObjectFileReader {
  head: StoredObjectHead = { status: "not_found" };
  read: StoredObjectFileStreamRead | null = null;

  async headById(): Promise<StoredObjectHead> {
    return this.head;
  }

  async tryGetById(): Promise<StoredObjectFileStreamRead | null> {
    return this.read;
  }
}

export function createStoredObjectTestOwners(
  projectId: string | null = null,
): StoredObjectOwnerResolver {
  return {
    tryResolve: async () => (projectId ? { projectId } : null),
  } as StoredObjectOwnerResolver;
}

export function createStoredObjectTestInfrastructure(
  overrides: Partial<StoredObjectInfrastructure> = {},
): StoredObjectInfrastructure {
  return {
    storage: new MemoryStoredObjectStorage(),
    delivery: new FixedStoredObjectDelivery(),
    uploadTokens: new MemoryStoredObjectTokens(),
    idDeriver: { fromDigest: ({ sha256 }) => `so_${sha256.slice(0, 8)}` },
    maximumUploadBytes: 1024,
    uploadExpiryMs: 300_000,
    files: new MemoryStoredObjectFiles(),
    owners: createStoredObjectTestOwners(),
    ...overrides,
  };
}

export function createStoredObjectTestApp(
  input: Readonly<{
    repositories?: StoredObjectRepositories;
    members?: Partial<StoredObjectInfrastructure>;
  }> = {},
): StoredObjectApp {
  return StoredObjectApp.create({
    repositories: input.repositories ?? MemoryStoredObjectRepositories.create(),
    members: createStoredObjectTestInfrastructure(input.members ?? {}),
    dependencies: {},
    config: void 0,
    resources: new ResourceScope(),
  });
}
