/**
 * One table, one owning module: the project module owns `Project`/`Team`,
 * the API-key module owns `ApiKey` and asks the project directory for the
 * rest, so booting both must not raise an ownership conflict.
 * @see dev/docs/adr/134-private-prisma-table-ownership.md
 */
import type { ApiKeyServerConfig } from "@langwatch/api-key-contract";
import { apiKeyServer } from "@langwatch/api-key-server";
import { AuthzApi } from "@langwatch/authz-contract";
import { createApp } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { projectServer, type ProjectInfrastructure } from "@langwatch/project-server";
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
  const runtime = await createApp({ role: "worker" })
    .withModules([projectServer, apiKeyServer])
    .withConfig({ "api-key": apiKeys })
    .withRelational(createWorkerProcessDatabase())
    .withEncryption({ encrypt: (value: string) => value })
    .withObservability((observability) => observability.withLogging({ error: () => void 0 }))
    .withMember("topicClustering", project.topicClustering)
    .provide({
      authz: createApiFixture<AuthzApi>({}, "authorization"),
      organization: createApiFixture<OrganizationApi>({}, "organizations"),
      share: createApiFixture<ShareApi>({}, "shares"),
      topic: createApiFixture<TopicApi>({}, "topics"),
    })
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
