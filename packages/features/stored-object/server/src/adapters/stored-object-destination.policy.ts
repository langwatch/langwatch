import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import { StoredObjectProjectDestinationResolverPort } from "./stored-object-storage.runtime";

export type StoredObjectStorageSelection = Readonly<{
  backend: "azure" | "s3" | "file";
  globalS3Bucket?: string;
  localFilesystemRoot: string;
  azure?: StoredObjectAzureDestinationPort;
}>;

export abstract class StoredObjectAzureDestinationPort {
  abstract resolve(): Readonly<{ accountName: string; container: string }>;
}

export abstract class StoredObjectProjectS3ConfigPort {
  abstract tryGet(projectId: string): Promise<Readonly<{ bucket: string }> | null>;
}

/** Pure BYOC-first destination policy; environment parsing stays at roots. */
export class StoredObjectDestinationPolicy extends StoredObjectProjectDestinationResolverPort {
  static create(options: {
    selection: StoredObjectStorageSelection;
    projects: StoredObjectProjectS3ConfigPort;
  }): StoredObjectDestinationPolicy {
    return new StoredObjectDestinationPolicy(options.selection, options.projects);
  }

  private constructor(
    private readonly selection: StoredObjectStorageSelection,
    private readonly projects: StoredObjectProjectS3ConfigPort,
  ) {
    super();
  }

  async resolve(projectId: string): Promise<StoredObjectStorageDestination> {
    const privateConfig = await this.projects.tryGet(projectId);
    if (privateConfig?.bucket) return { kind: "s3", bucket: privateConfig.bucket };

    if (this.selection.backend === "azure") {
      const azure = this.selection.azure?.resolve();
      if (!azure) {
        throw new Error("Azure storage destination is missing its validated configuration");
      }
      return { kind: "azure", ...azure };
    }

    if (this.selection.globalS3Bucket?.trim()) {
      return { kind: "s3", bucket: this.selection.globalS3Bucket.trim() };
    }
    return { kind: "file", root: this.selection.localFilesystemRoot };
  }
}
