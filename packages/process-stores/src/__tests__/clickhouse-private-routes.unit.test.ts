import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { storesOwner, type StoresConfig } from "../config-owner.ts";
import { openProcessStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  shutdownDrainTimeoutMs: undefined,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  redis: { dbIndex: undefined },
  objectStorage: {
    backend: "file",
    localRoot: "/tmp/langwatch-clickhouse-private-routes-test",
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: undefined,
      accountName: undefined,
      container: undefined,
      endpoint: undefined,
      authorityHost: undefined,
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: undefined,
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

/** The tenant directory the member routes through reads Postgres, lazily; nothing connects here. */
const DATABASE = { DATABASE_URL: "postgresql://langwatch@database.invalid:5432/langwatch" };

async function privateOrganizations(environment: Record<string, string>) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { ...DATABASE, ...environment } }).withEnv(),
  );
  const { members } = await openProcessStores({
    name: "clickhouse-private-routes-test",
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: false,
  });
  try {
    return [...members.read("clickhouse").privateRoutes().keys()];
  } finally {
    await members.close();
  }
}

describe("given the stores open over main's CLICKHOUSE_URL__ family", () => {
  describe("when an organization names its own server and no shared URL is set", () => {
    /** @scenario "The stores parse the route family into the clickhouse member at boot" */
    it("opens the clickhouse member routing that organization privately", async () => {
      await expect(
        privateOrganizations({ CLICKHOUSE_URL__acme__org_1: "http://private.invalid:8123" }),
      ).resolves.toEqual(["org_1"]);
    });
  });

  describe("when an entry names no organization", () => {
    /** @scenario "A route entry naming no organization is skipped" */
    it("adds no private route for it", async () => {
      await expect(
        privateOrganizations({
          CLICKHOUSE_URL: "http://shared.invalid:8123",
          CLICKHOUSE_URL__acme__: "http://private.invalid:8123",
        }),
      ).resolves.toEqual([]);
    });
  });
});
