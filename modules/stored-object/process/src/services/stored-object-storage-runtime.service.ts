import type { Readable } from "node:stream";

import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";

import type { StoredObjectBlobRepository } from "#repositories/stored-object-blob.repository";

import { StoredObjectStorageRegistryService } from "./stored-object-storage-registry.service.ts";

export type StoredObjectStorageProject = {
  objectStore: StoredObjectByteStore;
  resolveDestination(): Promise<StoredObjectStorageDestination>;
};

interface StoredObjectByteStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
}

export abstract class StoredObjectProjectDestinationResolver {
  abstract resolve(projectId: string): Promise<StoredObjectStorageDestination>;
}

export type StoredObjectStorageRuntimeOptions = {
  destination: StoredObjectProjectDestinationResolver;
  s3ForProject(projectId: string, aws: AwsClientProcessRuntime): StoredObjectBlobRepository;
  fileForProject(projectId: string, aws: AwsClientProcessRuntime): StoredObjectBlobRepository;
  azureForProject?: (projectId: string, aws: AwsClientProcessRuntime) => StoredObjectBlobRepository;
};

/** Creates project-scoped storage views from one canonical registry policy. */
export class StoredObjectStorageRuntimeService {
  static create(options: StoredObjectStorageRuntimeOptions): StoredObjectStorageRuntimeService {
    return new StoredObjectStorageRuntimeService(options);
  }

  private constructor(private readonly options: StoredObjectStorageRuntimeOptions) {}

  forProject(projectId: string, aws: AwsClientProcessRuntime): StoredObjectStorageProject {
    const azureForProject = this.options.azureForProject;
    const registry = StoredObjectStorageRegistryService.create({
      s3: this.options.s3ForProject(projectId, aws),
      file: this.options.fileForProject(projectId, aws),
      ...(azureForProject ? { "azure-blob": () => azureForProject(projectId, aws) } : {}),
    });
    return {
      objectStore: registry,
      resolveDestination: () => this.options.destination.resolve(projectId),
    };
  }
}
