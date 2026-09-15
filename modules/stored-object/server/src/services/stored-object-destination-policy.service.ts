import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import { StoredObjectProjectDestinationResolver } from "./stored-object-storage-runtime.service.ts";

export type StoredObjectStorageSelection = Readonly<{
  backend: "azure" | "s3" | "file";
  globalS3Bucket?: string;
  localFilesystemRoot: string;
  azure?: StoredObjectAzureDestination;
}>;

export abstract class StoredObjectAzureDestination {
  abstract resolve(): Readonly<{ accountName: string; container: string }>;
}

export abstract class StoredObjectProjectS3Config {
  abstract tryGet(projectId: string): Promise<Readonly<{ bucket: string }> | null>;
}

/** Pure BYOC-first destination policy; environment parsing stays at roots. */
export class StoredObjectDestinationPolicyAdapter extends StoredObjectProjectDestinationResolver {
  static create(options: {
    selection: StoredObjectStorageSelection;
    projects: StoredObjectProjectS3Config;
  }): StoredObjectDestinationPolicyAdapter {
    return new StoredObjectDestinationPolicyAdapter(options.selection, options.projects);
  }

  private constructor(
    private readonly selection: StoredObjectStorageSelection,
    private readonly projects: StoredObjectProjectS3Config,
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

    const globalS3Bucket = this.selection.globalS3Bucket?.trim();
    if (globalS3Bucket) {
      return { kind: "s3", bucket: globalS3Bucket };
    }
    return { kind: "file", root: this.selection.localFilesystemRoot };
  }
}
