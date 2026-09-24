import { Readable } from "node:stream";

import { AwsClientProcessRuntime } from "@langwatch/aws-client";
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import type { StoredObjectStorageDriver } from "#repositories/stored-object-blob.repository";

import type { StoredObjectStorageAddress } from "../../app/stored-object.members.ts";
import {
  StoredObjectStorageRuntimeAdapter,
  StoredObjectProjectDestinationResolver,
} from "../stored-object-storage-runtime.service.ts";
import { StoredObjectStorageService } from "../stored-object-storage.service.ts";

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

class RecordingDriver extends MemoryDriver {
  readonly written: string[] = [];

  override async put(uri: string, bytes: Buffer) {
    this.written.push(uri);
    await super.put(uri, bytes);
  }
}

describe("StoredObjectStorageService", () => {
  describe("when the checkup probes a project's destination", () => {
    it("writes an object under the project and removes it again", async () => {
      const driver = new RecordingDriver();
      const adapter = StoredObjectStorageService.create({
        runtime: StoredObjectStorageRuntimeAdapter.create({
          destination: new Destination(),
          s3ForProject: () => driver,
          fileForProject: () => driver,
        }),
        aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
      });

      await expect(adapter.resolveDestination({ projectId: "project-1" })).resolves.toEqual({
        kind: "s3",
        bucket: "bucket",
      });
      await adapter.probe({ projectId: "project-1" });

      expect(driver.written).toHaveLength(1);
      expect(driver.written[0]).toMatch(/^s3:\/\/bucket\/project-1\/checkup\//);
      expect(driver.values.size).toBe(0);
    });
  });

  it("preserves canonical addresses and hashes existing bytes", async () => {
    const driver = new MemoryDriver();
    const runtime = StoredObjectStorageRuntimeAdapter.create({
      destination: new Destination(),
      s3ForProject: () => driver,
      fileForProject: () => driver,
    });
    const adapter = StoredObjectStorageService.create({
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
    await expect(adapter.getStat({ projectId: "project-1", address })).resolves.toEqual({
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
    const adapter = StoredObjectStorageService.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    await expect(
      adapter.getBytes({
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
    const adapter = StoredObjectStorageService.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    await expect(
      adapter.getBytes({
        projectId: "project-1",
        address: { provider: "s3", destinationId: "bucket", relativeId },
      }),
    ).rejects.toThrow(Error);
  });

  it("rejects unknown providers and destination injection", async () => {
    const runtime = StoredObjectStorageRuntimeAdapter.create({
      destination: new Destination(),
      s3ForProject: () => new MemoryDriver(),
      fileForProject: () => new MemoryDriver(),
    });
    const adapter = StoredObjectStorageService.create({
      runtime,
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
    });

    const addresses: readonly StoredObjectStorageAddress[] = [
      { provider: "gcs", destinationId: "bucket", relativeId: "project-1/object-1" },
      { provider: "s3", destinationId: "bucket/other", relativeId: "project-1/object-1" },
      {
        provider: "azure-blob",
        destinationId: "account/container/extra",
        relativeId: "project-1/object-1",
      },
    ];
    for (const address of addresses) {
      await expect(adapter.getBytes({ projectId: "project-1", address })).rejects.toThrow(Error);
    }
  });

  describe("when a read races a delete", () => {
    it("turns the missing-object failure into the not-found error", async () => {
      const failure = new ObjectNotFoundError("s3://bucket/project-1/object-1");
      const driver = new ThrowingReadDriver(failure);
      driver.values.set("s3://bucket/project-1/object-1", Buffer.from("present"));
      const runtime = StoredObjectStorageRuntimeAdapter.create({
        destination: new Destination(),
        s3ForProject: () => driver,
        fileForProject: () => driver,
      });
      const adapter = StoredObjectStorageService.create({
        runtime,
        aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
      });
      const read = adapter.getBytes({
        projectId: "project-1",
        address: { provider: "s3", destinationId: "bucket", relativeId: "project-1/object-1" },
      });
      await expect(read).rejects.toMatchObject({ code: "stored_object_not_found" });
    });

    it("propagates any other read failure", async () => {
      const failure = new Error("network");
      const driver = new ThrowingReadDriver(failure);
      driver.values.set("s3://bucket/project-1/object-1", Buffer.from("present"));
      const runtime = StoredObjectStorageRuntimeAdapter.create({
        destination: new Destination(),
        s3ForProject: () => driver,
        fileForProject: () => driver,
      });
      const adapter = StoredObjectStorageService.create({
        runtime,
        aws: AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() }),
      });
      const read = adapter.getBytes({
        projectId: "project-1",
        address: { provider: "s3", destinationId: "bucket", relativeId: "project-1/object-1" },
      });
      await expect(read).rejects.toThrow("network");
    });
  });
});
