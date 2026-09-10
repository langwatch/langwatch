import { createHash } from "node:crypto";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  mintStoredObjectUri,
  ObjectNotFoundError,
  type StoredObjectStorageDestination,
  type StoredObjectByteStream,
} from "@langwatch/stored-object-contract";
import {
  StoredObjectStoragePort,
  type StoredObjectStorageAddress,
} from "../app/stored-object.infrastructure.ts";
import { StoredObjectStorageRuntimeAdapter } from "./stored-object-storage-runtime.service.ts";

export class StoredObjectStoragePortAdapter extends StoredObjectStoragePort {
  static create(input: {
    runtime: StoredObjectStorageRuntimeAdapter;
    aws: AwsClientProcessRuntime;
  }): StoredObjectStoragePortAdapter {
    return new StoredObjectStoragePortAdapter(input.runtime, input.aws);
  }

  private constructor(
    private readonly runtime: StoredObjectStorageRuntimeAdapter,
    private readonly aws: AwsClientProcessRuntime,
  ) {
    super();
  }

  async write(input: {
    projectId: string;
    objectId: string;
    bytes: Uint8Array;
    mediaType: string;
  }): Promise<StoredObjectStorageAddress> {
    const project = this.runtime.forProject(input.projectId, this.aws);
    const destination = await project.resolveDestination();
    const address = addressFor(destination, `${input.projectId}/${input.objectId}`);
    assertProjectAddress(input.projectId, address);
    await project.objectStore.put(uriFor(address), Buffer.from(input.bytes), input.mediaType);
    return address;
  }

  async tryCreateUpload(): Promise<null> {
    return null;
  }

  async tryStat(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<{ byteLength: number; sha256: string } | null> {
    assertProjectAddress(input.projectId, input.address);
    const project = this.runtime.forProject(input.projectId, this.aws);
    if (!(await project.objectStore.exists(uriFor(input.address)))) return null;
    let stream;
    try {
      stream = await project.objectStore.get(uriFor(input.address));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return null;
      throw error;
    }
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      hash.update(bytes);
    }
    return { byteLength, sha256: hash.digest("hex") };
  }

  async tryRead(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<StoredObjectByteStream | null> {
    assertProjectAddress(input.projectId, input.address);
    const project = this.runtime.forProject(input.projectId, this.aws);
    if (!(await project.objectStore.exists(uriFor(input.address)))) return null;
    try {
      return await project.objectStore.get(uriFor(input.address));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return null;
      throw error;
    }
  }

  async delete(input: { projectId: string; address: StoredObjectStorageAddress }): Promise<void> {
    assertProjectAddress(input.projectId, input.address);
    const project = this.runtime.forProject(input.projectId, this.aws);
    await project.objectStore.delete(uriFor(input.address));
  }
}

function assertProjectAddress(projectId: string, address: StoredObjectStorageAddress): void {
  if (!isProvider(address.provider) || !isSafeSegment(address.destinationId, address.provider)) {
    throw new Error("Stored object address has an invalid provider destination");
  }
  const segments = address.relativeId.split("/");
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("%") ||
        /[\u0000-\u001f?#]/u.test(segment),
    ) ||
    address.relativeId.includes("\\") ||
    segments[0] !== projectId
  ) {
    throw new Error("Stored object address is outside the requested project");
  }
}

function isProvider(value: string): value is "s3" | "file" | "azure-blob" {
  return value === "s3" || value === "file" || value === "azure-blob";
}

function isSafeSegment(value: string, provider: string): boolean {
  if (!value || value.includes("\\") || value.includes("%") || /[\u0000-\u001f?#]/u.test(value)) {
    return false;
  }
  if (provider === "s3") return !value.includes("/");
  if (provider === "file") return !value.includes("//");
  const segments = value.split("/");
  return segments.length === 2 && segments.every((segment) => Boolean(segment));
}

function addressFor(
  destination: StoredObjectStorageDestination,
  relativeId: string,
): StoredObjectStorageAddress {
  return {
    provider: destination.kind === "azure" ? "azure-blob" : destination.kind,
    destinationId:
      destination.kind === "s3"
        ? destination.bucket
        : destination.kind === "file"
          ? destination.root
          : `${destination.accountName}/${destination.container}`,
    relativeId,
  };
}

function uriFor(address: StoredObjectStorageAddress): string {
  const destination: StoredObjectStorageDestination =
    address.provider === "s3"
      ? { kind: "s3", bucket: address.destinationId }
      : address.provider === "file"
        ? { kind: "file", root: address.destinationId }
        : (() => {
            const separator = address.destinationId.indexOf("/");
            if (separator < 1 || separator === address.destinationId.length - 1) {
              throw new Error("Invalid Azure stored-object destination address");
            }
            return {
              kind: "azure",
              accountName: address.destinationId.slice(0, separator),
              container: address.destinationId.slice(separator + 1),
            };
          })();
  return mintStoredObjectUri({ destination, objectPath: address.relativeId });
}
