import { createHash } from "node:crypto";
import {
  StoredObjectStoragePort,
  type StoredObjectStorageAddress,
} from "@langwatch/stored-object-server";
import { ObjectNotFoundError } from "~/server/stored-objects/errors";
import { AppUserAvatarStorageInfrastructurePort } from "./user-avatar-storage-infrastructure.adapter";

/** App provider adapter for the canonical User-avatar Stored Object service. */
export class AppUserAvatarStoredObjectStorageAdapter extends StoredObjectStoragePort {
  static create(
    infrastructure: AppUserAvatarStorageInfrastructurePort,
  ): AppUserAvatarStoredObjectStorageAdapter {
    return new AppUserAvatarStoredObjectStorageAdapter(infrastructure);
  }

  private constructor(private readonly infrastructure: AppUserAvatarStorageInfrastructurePort) {
    super();
  }

  async write(input: {
    projectId: string;
    objectId: string;
    bytes: Uint8Array;
    mediaType: string;
  }): Promise<StoredObjectStorageAddress> {
    const target = await this.infrastructure.prepareWrite(input);
    await target.registry.put(target.uri, Buffer.from(input.bytes), input.mediaType);
    return target.address;
  }

  async tryCreateUpload(): Promise<null> {
    return null;
  }

  async tryStat(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<{ byteLength: number; sha256: string } | null> {
    const bytes = await this.tryRead(input);
    if (!bytes) return null;

    const digest = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of bytes) {
      byteLength += chunk.byteLength;
      digest.update(chunk);
    }
    return { byteLength, sha256: digest.digest("hex") };
  }

  async tryRead(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<AsyncIterable<Uint8Array> | null> {
    const target = this.infrastructure.resolveStored(input);
    try {
      return await target.registry.get(target.uri);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return null;
      throw error;
    }
  }

  async delete(input: { projectId: string; address: StoredObjectStorageAddress }): Promise<void> {
    const target = this.infrastructure.resolveStored(input);
    await target.registry.delete(target.uri);
  }
}
