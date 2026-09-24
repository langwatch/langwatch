import { createHash } from "node:crypto";

import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import { generate } from "@langwatch/ksuid";
import {
  DirectUploadUnavailableError,
  mintStoredObjectUri,
  ObjectNotFoundError,
  StoredObjectNotFoundError,
  type StoredObjectStorageDestination,
  type StoredObjectByteStream,
} from "@langwatch/stored-object-contract";

import {
  StoredObjectStorage,
  type StoredObjectStorageAddress,
} from "../app/stored-object.members.ts";
import type { StoredObjectStorageRuntimeAdapter } from "./stored-object-storage-runtime.service.ts";

export class StoredObjectStorageService extends StoredObjectStorage {
  static create(input: {
    runtime: StoredObjectStorageRuntimeAdapter;
    aws: AwsClientProcessRuntime;
  }): StoredObjectStorageService {
    return new StoredObjectStorageService(input.runtime, input.aws);
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

  async createUpload(): Promise<never> {
    throw new DirectUploadUnavailableError();
  }

  async getStat(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<{ byteLength: number; sha256: string }> {
    const stream = await this.getBytes(input);
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      hash.update(bytes);
    }
    return { byteLength, sha256: hash.digest("hex") };
  }

  async getBytes(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<StoredObjectByteStream> {
    assertProjectAddress(input.projectId, input.address);
    const project = this.runtime.forProject(input.projectId, this.aws);
    if (!(await project.objectStore.exists(uriFor(input.address)))) {
      throw new StoredObjectNotFoundError();
    }
    try {
      return await project.objectStore.get(uriFor(input.address));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) throw new StoredObjectNotFoundError();
      throw error;
    }
  }

  async delete(input: { projectId: string; address: StoredObjectStorageAddress }): Promise<void> {
    assertProjectAddress(input.projectId, input.address);
    const project = this.runtime.forProject(input.projectId, this.aws);
    await project.objectStore.delete(uriFor(input.address));
  }

  resolveDestination(input: { projectId: string }): Promise<StoredObjectStorageDestination> {
    return this.runtime.forProject(input.projectId, this.aws).resolveDestination();
  }

  async probe(input: { projectId: string }): Promise<void> {
    const project = this.runtime.forProject(input.projectId, this.aws);
    const address = addressFor(
      await project.resolveDestination(),
      `${input.projectId}/checkup/${generate("stored-object").toString()}.txt`,
    );
    assertProjectAddress(input.projectId, address);
    await project.objectStore.put(uriFor(address), Buffer.from("checkup"), "text/plain");
    await project.objectStore.delete(uriFor(address));
  }
}

function assertProjectAddress(projectId: string, address: StoredObjectStorageAddress): void {
  if (!isProvider(address.provider) || !isSafeSegment(address.destinationId, address.provider)) {
    throw new Error("Stored object address has an invalid provider destination");
  }
  const segments = address.relativeId.split("/");
  const isOutsideRequestedProject =
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("%") ||
        /[^\P{Cc}\u007f-\u009f]|[?#]/u.test(segment),
    ) ||
    address.relativeId.includes("\\") ||
    segments[0] !== projectId;

  if (isOutsideRequestedProject) {
    throw new Error("Stored object address is outside the requested project");
  }
}

function isProvider(value: string): value is "s3" | "file" | "azure-blob" {
  return value === "s3" || value === "file" || value === "azure-blob";
}

function isSafeSegment(value: string, provider: string): boolean {
  const hasUnsafeCharacters =
    !value ||
    value.includes("\\") ||
    value.includes("%") ||
    /[^\P{Cc}\u007f-\u009f]|[?#]/u.test(value);

  if (hasUnsafeCharacters) {
    return false;
  }
  if (provider === "s3") return !value.includes("/");
  if (provider === "file") return !value.includes("//");
  const segments = value.split("/");
  return segments.length === 2 && segments.every((segment) => Boolean(segment));
}

function destinationIdFor(destination: StoredObjectStorageDestination): string {
  if (destination.kind === "s3") return destination.bucket;
  if (destination.kind === "file") return destination.root;

  return `${destination.accountName}/${destination.container}`;
}

function addressFor(
  destination: StoredObjectStorageDestination,
  relativeId: string,
): StoredObjectStorageAddress {
  return {
    provider: destination.kind === "azure" ? "azure-blob" : destination.kind,
    destinationId: destinationIdFor(destination),
    relativeId,
  };
}

function destinationFor(address: StoredObjectStorageAddress): StoredObjectStorageDestination {
  if (address.provider === "s3") return { kind: "s3", bucket: address.destinationId };
  if (address.provider === "file") return { kind: "file", root: address.destinationId };

  const separator = address.destinationId.indexOf("/");

  if (separator < 1 || separator === address.destinationId.length - 1) {
    throw new Error("Invalid Azure stored-object destination address");
  }

  return {
    kind: "azure",
    accountName: address.destinationId.slice(0, separator),
    container: address.destinationId.slice(separator + 1),
  };
}

function uriFor(address: StoredObjectStorageAddress): string {
  const destination = destinationFor(address);

  return mintStoredObjectUri({ destination, objectPath: address.relativeId });
}
