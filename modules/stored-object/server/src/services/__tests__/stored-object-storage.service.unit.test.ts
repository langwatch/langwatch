import { Readable } from "node:stream";
import { AwsClientProcessRuntime } from "@langwatch/aws-client";
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";
import { StoredObjectStoragePortAdapter } from "../stored-object-storage.service.ts";
import type { StoredObjectStorageAddress } from "../../app/stored-object.infrastructure.ts";
import {
  StoredObjectStorageRuntimeAdapter,
  StoredObjectProjectDestinationResolver,
} from "../stored-object-storage-runtime.service.ts";
import type { StoredObjectStorageDriver } from "#repositories/stored-object-blob.repository";

class NoProxy {
  tryResolveForHost() {
    return undefined;
  }
}

class Destination extends StoredObjectProjectDestinationResolver {
  async resolve() {
    return { kind: "s3" as const, bucket: "bucket" };
  }
}

class MemoryDriver implements StoredObjectStorageDriver {
  readonly values = new Map<string, Buffer>();

  async get(uri: string) {
    return Readable.from([this.values.get(uri) ?? Buffer.alloc(0)]);
  }

  async put(uri: string, bytes: Buffer) {
    this.values.set(uri, Buffer.from(bytes));
  }

  async delete(uri: string) {
    this.values.delete(uri);
  }

  async exists(uri: string) {
    return this.values.has(uri);
  }
}

class ThrowingReadDriver extends MemoryDriver {
  constructor(private readonly failure: Error) {
    super();
  }

  override async get(): Promise<Readable> {
    throw this.failure;
  }
}

describe("StoredObjectStoragePortAdapter", () => {
  it("preserves canonical addresses and hashes existing bytes", async () => {
    const driver = new MemoryDriver();
    const runtime = StoredObjectStorageRuntimeAdapter.create({
      destination: new Destination(),
      s3ForProject: () => driver,
      fileForProject: () => driver,
    });
    const adapter = StoredObjectStoragePortAdapter.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    const address = await adapter.write({
      projectId: "project-1",
      objectId: "object-1",
      bytes: new TextEncoder().encode("hello"),
      mediaType: "text/plain",
    });

    expect(address).toEqual({
      provider: "s3",
      destinationId: "bucket",
      relativeId: "project-1/object-1",
    });
    await expect(adapter.tryStat({ projectId: "project-1", address })).resolves.toEqual({
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
  });

  it("does not read another project through a caller-supplied project address", async () => {
    const runtime = StoredObjectStorageRuntimeAdapter.create({
      destination: new Destination(),
      s3ForProject: () => new MemoryDriver(),
      fileForProject: () => new MemoryDriver(),
    });
    const adapter = StoredObjectStoragePortAdapter.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    await expect(
      adapter.tryRead({
        projectId: "project-1",
        address: { provider: "s3", destinationId: "bucket", relativeId: "project-2/object-1" },
      }),
    ).rejects.toThrow("outside the requested project");
  });

  it.each([
    "project-1/../project-2/object-1",
    "project-1/%2e%2e/project-2/object-1",
    "project-1/%252e%252e/project-2/object-1",
    "project-1\\..\\project-2\\object-1",
    "project-1/\t../project-2/object-1",
    "project-1/../project-2/object?x=1",
  ])("rejects traversal address %s before URI construction", async (relativeId) => {
    const runtime = StoredObjectStorageRuntimeAdapter.create({
      destination: new Destination(),
      s3ForProject: () => new MemoryDriver(),
      fileForProject: () => new MemoryDriver(),
    });
    const adapter = StoredObjectStoragePortAdapter.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    await expect(
      adapter.tryRead({
        projectId: "project-1",
        address: { provider: "s3", destinationId: "bucket", relativeId },
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown providers and destination injection", async () => {
    const runtime = StoredObjectStorageRuntimeAdapter.create({
      destination: new Destination(),
      s3ForProject: () => new MemoryDriver(),
      fileForProject: () => new MemoryDriver(),
    });
    const adapter = StoredObjectStoragePortAdapter.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    const addresses: ReadonlyArray<StoredObjectStorageAddress> = [
      { provider: "gcs", destinationId: "bucket", relativeId: "project-1/object-1" },
      { provider: "s3", destinationId: "bucket/other", relativeId: "project-1/object-1" },
      {
        provider: "azure-blob",
        destinationId: "account/container/extra",
        relativeId: "project-1/object-1",
      },
    ];
    for (const address of addresses) {
      await expect(adapter.tryRead({ projectId: "project-1", address })).rejects.toThrow();
    }
  });

  it("turns a missing read race into null but propagates other read failures", async () => {
    for (const failure of [
      new ObjectNotFoundError("s3://bucket/project-1/object-1"),
      new Error("network"),
    ]) {
      const driver = new ThrowingReadDriver(failure);
      driver.values.set("s3://bucket/project-1/object-1", Buffer.from("present"));
      const runtime = StoredObjectStorageRuntimeAdapter.create({
        destination: new Destination(),
        s3ForProject: () => driver,
        fileForProject: () => driver,
      });
      const adapter = StoredObjectStoragePortAdapter.create({
        runtime,
        aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
      });
      const read = adapter.tryRead({
        projectId: "project-1",
        address: { provider: "s3", destinationId: "bucket", relativeId: "project-1/object-1" },
      });
      if (failure instanceof ObjectNotFoundError) {
        await expect(read).resolves.toBeNull();
      } else {
        await expect(read).rejects.toThrow("network");
      }
    }
  });
});
