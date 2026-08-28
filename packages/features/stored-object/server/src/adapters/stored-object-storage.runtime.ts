import type { Readable } from "node:stream";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import {
  StoredObjectStorageRegistry,
  type StoredObjectStorageDriver,
} from "./stored-object-storage.registry";

export type StoredObjectStorageProject = {
  objectStore: StoredObjectByteStore;
  resolveDestination(): Promise<StoredObjectStorageDestination>;
};

export interface StoredObjectByteStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

export abstract class StoredObjectProjectDestinationResolverPort {
  abstract resolve(projectId: string): Promise<StoredObjectStorageDestination>;
}

export type StoredObjectStorageRuntimeOptions = {
  destination: StoredObjectProjectDestinationResolverPort;
  s3ForProject(projectId: string, aws: AwsClientProcessRuntime): StoredObjectStorageDriver;
  fileForProject(projectId: string, aws: AwsClientProcessRuntime): StoredObjectStorageDriver;
  azureForProject?(
    projectId: string,
    aws: AwsClientProcessRuntime,
  ): StoredObjectStorageDriver | undefined;
};

/** Creates project-scoped storage views from one canonical registry policy. */
export class StoredObjectStorageRuntime {
  static create(options: StoredObjectStorageRuntimeOptions): StoredObjectStorageRuntime {
    return new StoredObjectStorageRuntime(options);
  }

  private constructor(private readonly options: StoredObjectStorageRuntimeOptions) {}

  forProject(projectId: string, aws: AwsClientProcessRuntime): StoredObjectStorageProject {
    const registry = new StoredObjectStorageRegistry({
      s3: this.options.s3ForProject(projectId, aws),
      file: this.options.fileForProject(projectId, aws),
      ...(this.options.azureForProject
        ? { "azure-blob": () => this.options.azureForProject?.(projectId, aws) }
        : {}),
    });
    return {
      objectStore: registry,
      resolveDestination: () => this.options.destination.resolve(projectId),
    };
  }
}
