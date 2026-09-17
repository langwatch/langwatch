/**
 * One table, one owning module: the project module owns `Project`/`Team`,
 * the API-key module owns `ApiKey` and asks the project directory for the
 * rest, so booting both must not raise an ownership conflict.
 * @see dev/docs/adr/134-private-prisma-table-ownership.md
 */
import type { ApiKeyServerConfig } from "@langwatch/api-key-contract";
import { apiKeyServer } from "@langwatch/api-key-server";
import { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { projectServer, type ProjectInfrastructure } from "@langwatch/project-server";
import { createApp, membersFrom } from "@langwatch/kernel";
import { ShareApi } from "@langwatch/share-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerProcessDatabase } from "./support/worker-database.double.ts";

const runtimes: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

const apiKeys: ApiKeyServerConfig = { pepper: "0".repeat(64) };
const project: ProjectInfrastructure = {
  topicClustering: createApiFixture<ProjectInfrastructure["topicClustering"]>(),
};

/** The two modules the conflict was between, over the process's one Postgres client. */
async function bootProjectAndApiKey() {
  const runtime = await createApp({
    role: "worker",
    config: { "api-key": apiKeys },
    members: membersFrom({
      prisma: createWorkerProcessDatabase(),
      encryption: { encrypt: (value: string) => value },
      logger: { error: () => void 0 },
      topicClustering: project.topicClustering,
    }),
  })
    .withProvided(AuthzApi, createApiFixture<AuthzApi>({}, "authorization"))
    .withProvided(OrganizationApi, createApiFixture<OrganizationApi>({}, "organizations"))
    .withProvided(ShareApi, createApiFixture<ShareApi>({}, "shares"))
    .withProvided(TopicApi, createApiFixture<TopicApi>({}, "topics"))
    .withModules([projectServer, apiKeyServer])
    .boot();
  runtimes.push(runtime);

  return runtime;
}

describe("given the project and API-key modules installed together", () => {
  describe("when the worker boots them over one Postgres client", () => {
    it("claims no table twice, so boot completes", async () => {
      await expect(bootProjectAndApiKey()).resolves.toBeDefined();
    });
  });
});
