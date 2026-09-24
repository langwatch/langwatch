/**
 * The doubles every stored-object test builds on: an in-process byte backend,
 * a token codec that remembers what it minted, a fixed delivery capability,
 * and the row-and-stream reads the byte surface performs.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi, AuthzDenialReason, PermissionDecision } from "@langwatch/authz-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import {
  StoredObjectNotFoundError,
  type StoredObjectDeliveryCapability,
  type StoredObjectOwnerResolver,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";

import type { ExternalImageChannel } from "../../channels/external-image.channel.ts";
import { MemoryExternalImageChannel } from "../../channels/memory/memory.external-image.channel.ts";
import { MemoryStoredObjectRepositories } from "../../repositories/memory/memory.stored-object.repositories.ts";
import type { StoredObjectRepositories } from "../../repositories/stored-object.repositories.ts";
import { StoredObjectUploadSignerService } from "../../services/stored-object-upload-signer.service.ts";
import type { StoredObjectPermissions } from "../../services/stored-object.service.ts";
import { StoredObjectApp, type StoredObjectInfrastructure } from "../stored-object.app.ts";
import {
  StoredObjectDelivery,
  StoredObjectStorage,
  type StoredObjectFileReader,
  type StoredObjectFileStreamRead,
  type StoredObjectPlacement,
  type StoredObjectProbe,
  type StoredObjectStorageAddress,
} from "../stored-object.members.ts";

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

  signed: "direct" | "through-process" = "direct";
  written: Uint8Array[] = [];

  async place(): Promise<StoredObjectPlacement> {
    return { address: storedObjectTestAddress, maxSinglePutBytes: Number.MAX_SAFE_INTEGER };
  }

  async write(input: { body: AsyncIterable<Uint8Array> }) {
    for await (const chunk of input.body) this.written.push(chunk);
    return { byteLength: 3, sha256: STORED_OBJECT_TEST_SHA256 };
  }

  async signUpload() {
    return this.signed === "direct"
      ? { kind: "direct" as const, url: "https://storage.example/upload", headers: {} }
      : { kind: "through-process" as const };
  }

  async getStat() {
    return { byteLength: 3, sha256: STORED_OBJECT_TEST_SHA256 };
  }

  async getBytes() {
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

  probes = 0;

  async resolveDestination(): Promise<StoredObjectStorageDestination> {
    return { kind: "s3", bucket: "langwatch-test" };
  }

  async probe(): Promise<void> {
    this.probes += 1;
  }
}

/** Seals with the identity cipher: the tests read what a URL carries, not the crypto. */
export function createStoredObjectTestSigner(): StoredObjectUploadSignerService {
  return StoredObjectUploadSignerService.create({
    encryption: { encrypt: (value) => value, decrypt: (value) => value },
    publicBaseUrl: "https://app.example",
  });
}

/** Grants exactly the project permissions a test names, denying the rest with the given reason. */
export class GrantedStoredObjectPermissions implements StoredObjectPermissions {
  constructor(
    readonly granted: readonly string[] = ["traces:view", "scenarios:view", "datasets:view"],
    readonly denialReason: AuthzDenialReason = "no-binding",
  ) {}

  async getDecision(input: { permission: string }): Promise<PermissionDecision> {
    if (this.granted.includes(input.permission)) {
      return { permitted: true, organizationRole: "MEMBER" };
    }

    return { permitted: false, organizationRole: "MEMBER", denialReason: this.denialReason };
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
  head: StoredObjectProbe = { status: "not_found" };
  read: StoredObjectFileStreamRead | null = null;

  async headById(): Promise<StoredObjectProbe> {
    return this.head;
  }

  async getById(): Promise<StoredObjectFileStreamRead> {
    if (!this.read) throw new StoredObjectNotFoundError();
    return this.read;
  }
}

export function createStoredObjectTestOwners(
  projectId: string | null = null,
): StoredObjectOwnerResolver {
  return {
    getOwner: async () => {
      if (!projectId) throw new StoredObjectNotFoundError();
      return { projectId };
    },
  } as StoredObjectOwnerResolver;
}

export function createStoredObjectTestInfrastructure(
  overrides: Partial<StoredObjectInfrastructure> = {},
): StoredObjectInfrastructure {
  return {
    storage: new MemoryStoredObjectStorage(),
    delivery: new FixedStoredObjectDelivery(),
    signer: createStoredObjectTestSigner(),
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
    permissions?: StoredObjectPermissions;
    images?: ExternalImageChannel;
  }> = {},
): StoredObjectApp {
  const permissions = input.permissions ?? new GrantedStoredObjectPermissions();

  return StoredObjectApp.fromInfrastructure({
    permissions: createApiFixture<AuthzApi>({
      getDecision: (args) => permissions.getDecision(args),
    }),
    rateLimiter: createApiFixture<RateLimiter>({}),
    repositories: input.repositories ?? MemoryStoredObjectRepositories.create(),
    infrastructure: createStoredObjectTestInfrastructure(input.members ?? {}),
    images: input.images ?? MemoryExternalImageChannel.create(),
  });
}
