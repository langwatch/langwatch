import { describe, expect, it } from "vitest";
import {
  StoredObjectAzureDestinationPort,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
  StoredObjectStorageRegistry,
} from "../src/storage";

class ProjectConfig extends StoredObjectProjectS3ConfigPort {
  constructor(private readonly bucket: string | null) {
    super();
  }

  async tryGet(): Promise<Readonly<{ bucket: string }> | null> {
    return this.bucket ? { bucket: this.bucket } : null;
  }
}

class AzureDestination extends StoredObjectAzureDestinationPort {
  calls = 0;

  resolve(): Readonly<{ accountName: string; container: string }> {
    this.calls += 1;
    return { accountName: "account", container: "container" };
  }
}

describe("Stored Object storage infrastructure", () => {
  it("keeps BYOC first and does not resolve inactive Azure configuration", async () => {
    const azure = new AzureDestination();
    const policy = StoredObjectDestinationPolicy.create({
      selection: {
        backend: "azure",
        localFilesystemRoot: "/objects",
        azure,
      },
      projects: new ProjectConfig("private-bucket"),
    });

    await expect(policy.resolve("project-1")).resolves.toEqual({
      kind: "s3",
      bucket: "private-bucket",
    });
    expect(azure.calls).toBe(0);
  });

  it("lazily constructs a registered provider only when its scheme is used", async () => {
    let azureCalls = 0;
    const driver = {
      get: async () => {
        throw new Error("not implemented");
      },
      put: async () => undefined,
      delete: async () => undefined,
      exists: async () => false,
    };
    const registry = new StoredObjectStorageRegistry({
      s3: driver,
      file: driver,
      "azure-blob": () => {
        azureCalls += 1;
        return driver;
      },
    });

    expect(azureCalls).toBe(0);
    await expect(registry.exists("azure-blob://account/container/key")).resolves.toBe(false);
    expect(azureCalls).toBe(1);
  });
});
