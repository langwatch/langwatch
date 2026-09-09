/**
 * One table, one owning module. The project module owns `Project` and `Team`;
 * the API-key module owns `ApiKey` and asks the project directory for the rest,
 * so booting the two together must not raise an ownership conflict.
 *
 * @see dev/docs/adr/134-private-prisma-table-ownership.md
 */
import {
  ApiKeyBindingIdAdapter,
  ApiKeyDiagnosticsAdapter,
  apiKeyServer,
  type ApiKeyInfrastructure,
} from "@langwatch/api-key-server";
import { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import { projectServer, type ProjectInfrastructure } from "@langwatch/project-server";
import { createApp } from "@langwatch/runtime-composition";
import { ShareApi } from "@langwatch/share-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerProcessDatabase } from "./support/worker-database.double.ts";

const runtimes: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

const apiKeys: ApiKeyInfrastructure = {
  pepper: "0".repeat(64),
  bindingIds: ApiKeyBindingIdAdapter.create(),
  deriveBindingId: () => "binding-1",
  diagnostics: ApiKeyDiagnosticsAdapter.create(createLogger("langwatch:test:api-key")),
};
const project: ProjectInfrastructure = {
  topicClustering: createApiFixture<ProjectInfrastructure["topicClustering"]>(),
};

/** The two modules the conflict was between, over the process's one Postgres client. */
async function bootProjectAndApiKey() {
  const runtime = await createApp({ name: "worker-tenancy-ownership-test" })
    .withPersistence("postgres", { prisma: createWorkerProcessDatabase() as never })
    .withInfrastructure({})
    .withProvided(AuthzApi, createApiFixture<AuthzApi>({}, "authorization"))
    .withProvided(OrganizationApi, createApiFixture<OrganizationApi>({}, "organizations"))
    .withProvided(ShareApi, createApiFixture<ShareApi>({}, "shares"))
    .withProvided(TopicApi, createApiFixture<TopicApi>({}, "topics"))
    .withModule(projectServer, { infrastructure: project })
    .withModule(apiKeyServer, { infrastructure: apiKeys })
    .boot({ role: "worker" });
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
