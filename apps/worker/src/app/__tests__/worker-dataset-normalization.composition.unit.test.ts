import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { AzureDatasetStorageAdapter, LocalDatasetStorageAdapter } from "@langwatch/dataset-server";
import {
  StoredObjectProjectDestinationResolverPort,
  StoredObjectStorageRuntime,
} from "@langwatch/stored-object-server/storage";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";
import {
  WorkerDatasetStorageResolver,
  type WorkerDatasetObjectStorage,
} from "../worker-dataset-normalization.composition";
import { WorkerProjectS3SourcePort } from "../../platform/infrastructure/worker-stored-object-storage.adapter";
import type { WorkerStorageConfig } from "../../platform/config/worker.config";

/**
 * Spec: specs/datasets/dataset-normalization-azure-storage.feature
 */

class NoProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

class NoS3Routes extends WorkerProjectS3SourcePort {
  async tryGet() {
    return null;
  }
}

class FixedDestination extends StoredObjectProjectDestinationResolverPort {
  constructor(private readonly destination: StoredObjectStorageDestination) {
    super();
  }

  async resolve(): Promise<StoredObjectStorageDestination> {
    return this.destination;
  }
}

/** Never reached by these tests: `forProject` builds one eagerly per scheme. */
const unusedDriver = {
  get: async () => {
    throw new Error("not composed for this test");
  },
  put: async () => {
    throw new Error("not composed for this test");
  },
  delete: async () => {
    throw new Error("not composed for this test");
  },
  exists: async () => {
    throw new Error("not composed for this test");
  },
};

function storageFor({
  destination,
  azure,
}: {
  destination: StoredObjectStorageDestination;
  azure: WorkerStorageConfig["azure"];
}): WorkerDatasetObjectStorage {
  const aws = AwsClientProcessRuntime.create({ outboundProxy: new NoProxy() });
  const runtime = StoredObjectStorageRuntime.create({
    destination: new FixedDestination(destination),
    s3ForProject: () => unusedDriver,
    fileForProject: () => unusedDriver,
  });
  return { runtime, aws, projects: new NoS3Routes(), azureConfig: azure };
}

const unconfiguredAzure: WorkerStorageConfig["azure"] = {
  backend: "azure",
  authMode: undefined,
  accountName: undefined,
  accountKey: undefined,
  container: undefined,
  endpoint: undefined,
  authorityHost: undefined,
  tokenAudience: undefined,
  allowInsecureTokenEndpointForTests: false,
  identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
};

const configuredAzure: WorkerStorageConfig["azure"] = {
  ...unconfiguredAzure,
  authMode: "sharedKey",
  accountName: "acct",
  accountKey: "key",
  container: "datasets",
};

describe("WorkerDatasetStorageResolver", () => {
  describe("given a project routed to Azure with a valid Azure Blob account", () => {
    /** @scenario "An Azure-routed project's dataset chunks resolve to the Azure adapter" */
    it("resolves the Azure dataset storage adapter, not a refusal and not the local filesystem", async () => {
      const storage = storageFor({
        destination: { kind: "azure", accountName: "acct", container: "datasets" },
        azure: configuredAzure,
      });
      const resolver = new WorkerDatasetStorageResolver(storage);

      const result = await resolver.forProject("project-1");

      expect(result).toBeInstanceOf(AzureDatasetStorageAdapter);
      expect(result).not.toBeInstanceOf(LocalDatasetStorageAdapter);
    });
  });

  describe("given a project routed to Azure with no Azure Blob account configured", () => {
    it("still resolves the Azure adapter rather than falling back to local disk", async () => {
      const storage = storageFor({
        destination: { kind: "azure", accountName: "acct", container: "datasets" },
        azure: unconfiguredAzure,
      });
      const resolver = new WorkerDatasetStorageResolver(storage);

      const result = await resolver.forProject("project-1");

      expect(result).toBeInstanceOf(AzureDatasetStorageAdapter);
      expect(result).not.toBeInstanceOf(LocalDatasetStorageAdapter);
    });
  });
});
