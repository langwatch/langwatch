// Azure can be selected globally while a tenant-owned BYOC S3 bucket still
// wins destination precedence, and an incompletely configured Azure branch
// must not be validated before an s3:// URI is dispatched.

/**
 * @vitest-environment node
 * Provider selection happens before scheme dispatch.
 * Spec: specs/migration/object-storage-provider-migration.feature
 */
import { Readable } from "node:stream";
import { mintS3StoredObjectUri } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import {
  StoredObjectAzureDestination,
  StoredObjectDestinationPolicyAdapter,
  StoredObjectProjectS3Config,
  type StoredObjectStorageSelection,
} from "../stored-object-destination-policy.service.ts";
import type { StoredObjectStorageDriver } from "#repositories/stored-object-blob.repository";
import { StoredObjectStorageRegistryAdapter } from "../stored-object-storage-registry.service.ts";

const INCOMPLETE_AZURE = "Azure Blob is configured with sharedKey auth and no account key";

/** The deployment's leftover Azure settings: present, and not valid. */
class IncompleteAzureDestination extends StoredObjectAzureDestination {
  resolve(): never {
    throw new Error(INCOMPLETE_AZURE);
  }
}

class StubProjectS3Config extends StoredObjectProjectS3Config {
  constructor(private readonly bucket: string | null) {
    super();
  }

  async tryGet(): Promise<Readonly<{ bucket: string }> | null> {
    return this.bucket ? { bucket: this.bucket } : null;
  }
}

function memoryS3Driver(): StoredObjectStorageDriver {
  const objects = new Map<string, Buffer>();
  return {
    put: async (uri, bytes) => {
      objects.set(uri, bytes);
    },
    get: async (uri) => {
      const stored = objects.get(uri);
      if (!stored) throw new Error(`missing ${uri}`);
      return Readable.from([stored]);
    },
    delete: async (uri) => {
      objects.delete(uri);
    },
    exists: async (uri) => objects.has(uri),
  };
}

async function roundTripS3Object(input: {
  selection: StoredObjectStorageSelection;
  privateBucket: string | null;
  projectId: string;
}) {
  const policy = StoredObjectDestinationPolicyAdapter.create({
    selection: input.selection,
    projects: new StubProjectS3Config(input.privateBucket),
  });
  const destination = await policy.resolve(input.projectId);
  if (destination.kind !== "s3") {
    throw new Error(`expected an S3 destination, resolved ${destination.kind}`);
  }

  const registry = StoredObjectStorageRegistryAdapter.create({
    s3: memoryS3Driver(),
    file: memoryS3Driver(),
    // Building the driver is what would read the incomplete settings. The
    // registry must not do it while dispatching an s3:// URI.
    "azure-blob": () => {
      throw new Error(INCOMPLETE_AZURE);
    },
  });
  const uri = mintS3StoredObjectUri({
    bucket: destination.bucket,
    projectId: input.projectId,
    sha256: "abc123",
  });
  await registry.put(uri, Buffer.from("payload"), "text/plain");

  const chunks: Buffer[] = [];
  for await (const chunk of await registry.get(uri)) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return { destination, body: Buffer.concat(chunks).toString("utf8") };
}

describe("inactive Azure configuration with S3 traffic", () => {
  describe("given incomplete Azure settings left in the deployment", () => {
    /** @scenario "An invalid inactive Azure configuration does not block S3 traffic" */
    it("round-trips a global-S3 project through the global bucket", async () => {
      expect(
        await roundTripS3Object({
          selection: {
            backend: "s3",
            globalS3Bucket: "global-bucket",
            localFilesystemRoot: "/tmp/stored-objects",
            azure: new IncompleteAzureDestination(),
          },
          privateBucket: null,
          projectId: "global-project",
        }),
      ).toEqual({
        destination: { kind: "s3", bucket: "global-bucket" },
        body: "payload",
      });
    });

    /** @scenario "An invalid inactive Azure configuration does not block S3 traffic" */
    it("round-trips a private-bucket project through the tenant's own bucket", async () => {
      expect(
        await roundTripS3Object({
          // Azure is the selected provider, and the tenant's own bucket still
          // wins: the inactive branch is never resolved.
          selection: {
            backend: "azure",
            localFilesystemRoot: "/tmp/stored-objects",
            azure: new IncompleteAzureDestination(),
          },
          privateBucket: "private-bucket",
          projectId: "private-project",
        }),
      ).toEqual({
        destination: { kind: "s3", bucket: "private-bucket" },
        body: "payload",
      });
    });
  });
});
