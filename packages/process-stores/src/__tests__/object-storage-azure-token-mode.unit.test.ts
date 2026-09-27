/**
 * @see specs/features/scenarios/azure-blob-workload-identity.feature
 */
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { storesOwner, type StoresConfig } from "../config-owner.ts";
import { openProcessStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const baseConfig: StoresConfig = {
  defaultRetentionDays: 30,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  objectStorage: {
    backend: "azure",
    localRoot: undefined,
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: "managedIdentity",
      accountName: "account",
      container: "objects",
      endpoint: "http://storage.example.test",
      authorityHost: "https://login.example.test",
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: "1",
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

/** Never dialled: the tenant directory the storage member takes opens no connection until asked. */
const UNREACHED_DATABASE = "postgresql://nobody:nothing@127.0.0.1:9/unreached";

type AzureSettings = StoresConfig["objectStorage"]["azure"];

async function objectStorageFor(options: { production: boolean; azure?: Partial<AzureSettings> }) {
  const { production, azure } = options;
  const config: StoresConfig = {
    ...baseConfig,
    objectStorage: {
      ...baseConfig.objectStorage,
      azure: { ...baseConfig.objectStorage.azure, ...azure },
    },
  };
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { DATABASE_URL: UNREACHED_DATABASE } }).withEnv(),
  );
  const members = await openProcessStores({
    name: "azure-token-mode-test",
    config,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production,
  });
  try {
    const storage = members.read("objectStorage");
    return { storage, destination: await storage.destination("project-1") };
  } catch (error) {
    return { refusal: error };
  } finally {
    await members.close();
  }
}

describe("given AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS is set", () => {
  describe("when a production process resolves its own configuration", () => {
    /** @scenario "The worker refuses the insecure token endpoint escape hatch in production, like the App does" */
    it("ignores the escape hatch and refuses the plaintext token endpoint", async () => {
      const { refusal } = await objectStorageFor({ production: true });

      expect(refusal).toMatchObject({ name: "AzureBackendMisconfiguredError" });
    });
  });

  describe("when a test process resolves the same configuration", () => {
    /** @scenario "The worker refuses the insecure token endpoint escape hatch in production, like the App does" */
    it("honours the escape hatch", async () => {
      const { storage, refusal } = await objectStorageFor({ production: false });

      expect(refusal).toBeUndefined();
      expect(storage).toBeDefined();
    });
  });
});

describe("given STORED_OBJECTS_BACKEND is azure in a token-based auth mode with no account key", () => {
  describe("when dataset storage is resolved for a project", () => {
    /** @scenario "Dataset storage is selected without dereferencing an absent account key" */
    it("selects the Azure account without reading a key", async () => {
      const { destination, refusal } = await objectStorageFor({
        production: true,
        azure: {
          endpoint: "https://account.blob.core.windows.net",
          allowInsecureTokenEndpointForTests: undefined,
        },
      });

      expect(refusal).toBeUndefined();
      expect(destination).toEqual({ kind: "azure", accountName: "account", container: "objects" });
    });
  });
});
