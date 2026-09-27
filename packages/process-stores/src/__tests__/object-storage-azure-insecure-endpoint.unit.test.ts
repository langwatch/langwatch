/**
 * @see specs/features/scenarios/azure-blob-workload-identity.feature
 */
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { storesOwner, type StoresConfig } from "../config-owner.ts";
import { openProcessStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const storesConfig: StoresConfig = {
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

async function objectStorageFor(production: boolean) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { DATABASE_URL: UNREACHED_DATABASE } }).withEnv(),
  );
  const members = await openProcessStores({
    name: "azure-insecure-endpoint-test",
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production,
  });
  try {
    return { storage: members.read("objectStorage") };
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
      const { refusal } = await objectStorageFor(true);

      expect(refusal).toMatchObject({ name: "AzureBackendMisconfiguredError" });
    });
  });

  describe("when a test process resolves the same configuration", () => {
    /** @scenario "The worker refuses the insecure token endpoint escape hatch in production, like the App does" */
    it("honours the escape hatch", async () => {
      const { storage, refusal } = await objectStorageFor(false);

      expect(refusal).toBeUndefined();
      expect(storage).toBeDefined();
    });
  });
});
