/**
 * @vitest-environment node
 *
 * Unit tests for StoredObjectDestinationPolicy — the BYOC-first destination
 * precedence that used to live inside StoredObjectsService's default
 * `mintStorageUri` (issue #6323 backend-flip posture). `mintStoredObjectUri`
 * (from @langwatch/stored-object-contract) turns the resolved destination
 * into the actual storage URI, mirroring what a composition root's injected
 * `mintStorageUri` does in production.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintStoredObjectUri } from "@langwatch/stored-object-contract";
import {
  AzureBackendMisconfiguredError,
  resolveAzureCredentials,
  type AzureBlobCredentialsConfig,
} from "../azure-blob-credentials";
import {
  StoredObjectAzureDestinationPort,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
} from "../stored-object-destination.policy";

const TEST_BYTES = Buffer.from("hello");
const PROJECT_ID = "proj-1";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

class StubProjects extends StoredObjectProjectS3ConfigPort {
  constructor(private readonly bucket: string | null) {
    super();
  }
  async tryGet(): Promise<Readonly<{ bucket: string }> | null> {
    return this.bucket ? { bucket: this.bucket } : null;
  }
}

class StubAzureDestination extends StoredObjectAzureDestinationPort {
  constructor(private readonly value: Readonly<{ accountName: string; container: string }>) {
    super();
  }
  resolve() {
    return this.value;
  }
}

async function mintFor(policy: StoredObjectDestinationPolicy, projectId: string): Promise<string> {
  const destination = await policy.resolve(projectId);
  return mintStoredObjectUri({
    destination,
    objectPath: `${projectId}/${sha256(TEST_BYTES)}`,
  });
}

describe("StoredObjectDestinationPolicy", () => {
  describe("when the project has a private dataplane bucket configured", () => {
    /** @scenario "For a project with a per-project private dataplane bucket, mintStorageUri uses the project bucket, not the global one" */
    it("mints the URI under the project bucket and ignores the global bucket", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "s3",
          globalS3Bucket: "langwatch-storage-prod",
          localFilesystemRoot: "/var/lib/langwatch",
        },
        projects: new StubProjects("dataplane-acme"),
      });

      const putUri = await mintFor(policy, PROJECT_ID);

      expect(putUri).toMatch(/^s3:\/\/dataplane-acme\//);
      expect(putUri).not.toMatch(/langwatch-storage-prod/);
    });
  });

  describe("when the project has no private bucket but a global S3 bucket is set", () => {
    /** @scenario "For a project without per-project storage configured, mintStorageUri falls back to the global S3_BUCKET_NAME" */
    it("mints the URI under the global bucket so the storage_uri matches what the read path will use", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "s3",
          globalS3Bucket: "langwatch-storage-prod",
          localFilesystemRoot: "/var/lib/langwatch",
        },
        projects: new StubProjects(null),
      });

      const putUri = await mintFor(policy, PROJECT_ID);

      expect(putUri).toMatch(/^s3:\/\/langwatch-storage-prod\//);
    });
  });

  describe("given the azure backend is configured with a complete Azure destination", () => {
    /**
     * Covers the destination-policy HALF of this scenario. The groupQueue
     * blob store half is bound separately in tieredBlobStore.unit.test.ts —
     * together they satisfy it; neither test covers both on its own.
     */
    /** @scenario "defaultMintStorageUri and the groupQueue blob store mint azure-blob URIs for an azure destination" */
    it("mints an azure-blob address for a project with no private bucket", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "azure",
          localFilesystemRoot: "/var/lib/langwatch",
          azure: new StubAzureDestination({
            accountName: "lwacct",
            container: "lw-container",
          }),
        },
        projects: new StubProjects(null),
      });

      const putUri = await mintFor(policy, PROJECT_ID);

      const expectedSha256 = sha256(TEST_BYTES);
      expect(putUri).toBe(`azure-blob://lwacct/lw-container/${PROJECT_ID}/${expectedSha256}`);
    });
  });

  describe("when the azure backend is selected but no azure destination is configured", () => {
    it("throws rather than silently falling back to another backend", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "azure",
          localFilesystemRoot: "/var/lib/langwatch",
        },
        projects: new StubProjects(null),
      });

      await expect(policy.resolve(PROJECT_ID)).rejects.toThrow(
        /Azure storage destination is missing/,
      );
    });
  });
});

/**
 * A destination port composed from `resolveAzureCredentials`, mirroring what
 * a composition root wires `StoredObjectAzureDestinationPort` to in
 * production. Used below to test the full BYOC -> azure -> global S3 -> local
 * filesystem precedence chain that used to live in one function,
 * `resolveProjectStorageDestination` — now split across
 * `StoredObjectDestinationPolicy` (the precedence) and
 * `resolveAzureCredentials` (the azure-arm validation).
 */
class ConfiguredAzureDestination extends StoredObjectAzureDestinationPort {
  constructor(private readonly config: AzureBlobCredentialsConfig) {
    super();
  }
  resolve() {
    const credentials = resolveAzureCredentials({ config: this.config });
    return { accountName: credentials.accountName, container: this.config.container! };
  }
}

function azureConfig(
  overrides: Partial<AzureBlobCredentialsConfig> = {},
): AzureBlobCredentialsConfig {
  return {
    authMode: undefined,
    accountName: undefined,
    accountKey: undefined,
    container: undefined,
    endpoint: undefined,
    authorityHost: undefined,
    tokenAudience: undefined,
    backend: "azure",
    allowInsecureTokenEndpointForTests: false,
    ...overrides,
  };
}

describe("StoredObjectDestinationPolicy composed with resolveAzureCredentials (BYOC -> azure -> global S3 -> local fs precedence)", () => {
  describe("given STORED_OBJECTS_BACKEND=azure with complete Azure config and no private bucket", () => {
    /** @scenario "Operator selects Azure Blob as the stored-objects write backend" */
    it("returns an azure destination carrying the account name and container", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "azure",
          localFilesystemRoot: "/data/objects",
          azure: new ConfiguredAzureDestination(
            azureConfig({
              accountName: "lwacct",
              accountKey: "key-value",
              container: "lw-container",
            }),
          ),
        },
        projects: new StubProjects(null),
      });

      const destination = await policy.resolve("proj_1");

      expect(destination).toEqual({
        kind: "azure",
        accountName: "lwacct",
        container: "lw-container",
      });
    });
  });

  describe.each([
    ["AZURE_BLOB_ACCOUNT_NAME"],
    ["AZURE_BLOB_ACCOUNT_KEY"],
    ["AZURE_BLOB_CONTAINER"],
  ])("given STORED_OBJECTS_BACKEND=azure with %s missing", (missingVariable) => {
    /** @scenario "Azure backend selection fails loud when the Azure config is incomplete" */
    it(`raises a configuration error naming ${missingVariable} and does not fall back`, async () => {
      const config = azureConfig({
        accountName: "lwacct",
        accountKey: "key-value",
        container: "lw-container",
      });
      const key = {
        AZURE_BLOB_ACCOUNT_NAME: "accountName",
        AZURE_BLOB_ACCOUNT_KEY: "accountKey",
        AZURE_BLOB_CONTAINER: "container",
      }[missingVariable] as keyof AzureBlobCredentialsConfig;
      (config as Record<string, unknown>)[key] = undefined;

      // The fallback destinations are configured too, to prove the resolver
      // does NOT quietly fall through to either when azure is misconfigured.
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "azure",
          globalS3Bucket: "global-bucket",
          localFilesystemRoot: "/data/objects",
          azure: new ConfiguredAzureDestination(config),
        },
        projects: new StubProjects(null),
      });

      await expect(policy.resolve("proj_1")).rejects.toBeInstanceOf(AzureBackendMisconfiguredError);
      await expect(policy.resolve("proj_1")).rejects.toThrow(new RegExp(missingVariable));
    });
  });

  describe("given an unrelated backend value or none at all", () => {
    /** @scenario "Azure env vars alone never flip the write destination" */
    it("falls back to the global S3 bucket when configured, minting no azure-blob uri", async () => {
      // backend intentionally "s3" — azure env vars configured but never
      // consulted because the backend toggle is not "azure".
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "s3",
          globalS3Bucket: "global-bucket",
          localFilesystemRoot: "/data/objects",
        },
        projects: new StubProjects(null),
      });

      const destination = await policy.resolve("proj_1");

      expect(destination).toEqual({ kind: "s3", bucket: "global-bucket" });
    });

    /** @scenario "Azure env vars alone never flip the write destination" */
    it("falls back to the local filesystem when no global bucket is configured either", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "s3",
          localFilesystemRoot: "/data/objects",
        },
        projects: new StubProjects(null),
      });

      const destination = await policy.resolve("proj_1");

      expect(destination.kind).toBe("file");
    });
  });

  describe("given STORED_OBJECTS_BACKEND=azure with complete config AND a global S3 bucket set", () => {
    /** @scenario "The azure toggle beats the global S3 bucket but not a BYOC bucket" */
    it("resolves to azure, not the global S3 bucket", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "azure",
          globalS3Bucket: "global-bucket",
          localFilesystemRoot: "/data/objects",
          azure: new ConfiguredAzureDestination(
            azureConfig({
              accountName: "lwacct",
              accountKey: "key-value",
              container: "lw-container",
            }),
          ),
        },
        projects: new StubProjects(null),
      });

      const destination = await policy.resolve("proj_1");

      expect(destination.kind).toBe("azure");
    });
  });

  describe("given STORED_OBJECTS_BACKEND=azure with complete config AND a per-project private bucket", () => {
    /** @scenario "A per-project private dataplane bucket still beats the Azure backend toggle" */
    it("resolves to the project's private S3 bucket, not azure", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "azure",
          localFilesystemRoot: "/data/objects",
          azure: new ConfiguredAzureDestination(
            azureConfig({
              accountName: "lwacct",
              accountKey: "key-value",
              container: "lw-container",
            }),
          ),
        },
        projects: new StubProjects("private-bucket"),
      });

      const destination = await policy.resolve("proj_1");

      expect(destination).toEqual({ kind: "s3", bucket: "private-bucket" });
    });
  });

  describe("given no S3 bucket and no Azure config are present", () => {
    /** @scenario "The legacy S3 selector keeps its existing fallback behavior" */
    it("falls back to a file destination when the legacy s3 selector has no bucket", async () => {
      const policy = StoredObjectDestinationPolicy.create({
        selection: {
          backend: "s3",
          localFilesystemRoot: "/data/objects",
        },
        projects: new StubProjects(null),
      });

      const destination = await policy.resolve("proj_x");

      expect(destination.kind).toBe("file");
    });
  });
});
