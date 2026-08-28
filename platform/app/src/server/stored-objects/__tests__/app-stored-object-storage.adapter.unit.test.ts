import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ObjectNotFoundError } from "../errors";
import { StorageRegistry } from "../storage-registry";
import type { StorageDriver } from "../storage-driver";
import {
  AppUserAvatarStorageInfrastructurePort,
  type AppUserAvatarStorageTarget,
} from "~/runtime/app/features/user-avatar-storage-infrastructure.adapter";
import { AppUserAvatarStoredObjectStorageAdapter } from "~/runtime/app/features/user-avatar-stored-object-storage.adapter";

class MemoryDriver implements StorageDriver {
  readonly bytes = new Map<string, Buffer>();

  async get(uri: string): Promise<Readable> {
    const value = this.bytes.get(uri);
    if (!value) throw new ObjectNotFoundError(uri);
    return Readable.from([value]);
  }

  async put(uri: string, bytes: Buffer): Promise<void> {
    this.bytes.set(uri, bytes);
  }

  async delete(uri: string): Promise<void> {
    this.bytes.delete(uri);
  }

  async exists(uri: string): Promise<boolean> {
    return this.bytes.has(uri);
  }
}

class StubAvatarStorageInfrastructure extends AppUserAvatarStorageInfrastructurePort {
  constructor(
    private readonly registry: StorageRegistry,
    private readonly destination: { provider: string; destinationId: string },
  ) {
    super();
  }

  async prepareWrite(input: { projectId: string; objectId: string }) {
    return this.target({
      provider: this.destination.provider,
      destinationId: this.destination.destinationId,
      relativeId: `${input.projectId}/${input.objectId}`,
    });
  }

  resolveStored(input: {
    projectId: string;
    address: { provider: string; destinationId: string; relativeId: string };
  }): AppUserAvatarStorageTarget {
    return this.target(input.address);
  }

  private target(address: { provider: string; destinationId: string; relativeId: string }) {
    return {
      registry: this.registry,
      address,
      uri: `${address.provider}://${address.destinationId}/${address.relativeId}`,
    };
  }
}

function fixture(destination: { provider: string; destinationId: string }) {
  const driver = new MemoryDriver();
  const registry = new StorageRegistry({
    s3: driver,
    file: driver,
    "azure-blob": driver,
  });
  return {
    adapter: AppUserAvatarStoredObjectStorageAdapter.create(
      new StubAvatarStorageInfrastructure(registry, destination),
    ),
    driver,
  };
}

describe("AppUserAvatarStoredObjectStorageAdapter", () => {
  it("writes a canonical S3 address through the existing registry", async () => {
    const { adapter, driver } = fixture({ provider: "s3", destinationId: "project-bucket" });

    const address = await adapter.write({
      projectId: "project_1",
      objectId: "object_1",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "application/octet-stream",
    });

    expect(address).toEqual({
      provider: "s3",
      destinationId: "project-bucket",
      relativeId: "project_1/object_1",
    });
    expect(driver.bytes.get("s3://project-bucket/project_1/object_1")).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  it("retains the Azure account and container in the canonical address", async () => {
    const { adapter, driver } = fixture({
      provider: "azure-blob",
      destinationId: "account/objects",
    });

    const address = await adapter.write({
      projectId: "project_1",
      objectId: "object_1",
      bytes: new Uint8Array([1]),
      mediaType: "application/octet-stream",
    });

    expect(address).toEqual({
      provider: "azure-blob",
      destinationId: "account/objects",
      relativeId: "project_1/object_1",
    });
    expect(driver.bytes.has("azure-blob://account/objects/project_1/object_1")).toBe(true);
  });

  it("returns null for absent bytes and hashes existing bytes without trusting a URI", async () => {
    const { adapter } = fixture({ provider: "file", destinationId: "/var/lib/langwatch" });
    const address = await adapter.write({
      projectId: "project_1",
      objectId: "object_1",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "application/octet-stream",
    });

    await expect(adapter.tryStat({ projectId: "project_1", address })).resolves.toEqual({
      byteLength: 3,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    await expect(
      adapter.tryRead({
        projectId: "project_1",
        address: { ...address, relativeId: "project_1/missing" },
      }),
    ).resolves.toBeNull();
  });
});
