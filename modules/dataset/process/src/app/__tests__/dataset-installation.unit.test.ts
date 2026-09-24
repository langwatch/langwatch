import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 *
 * The dataset feature, booted the way a process boots it: over the memory
 * repositories, with the two peers it declares, in every role it serves.
 */
import { DatasetApi, DatasetNotFoundError } from "@langwatch/dataset-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { memoryStores } from "@langwatch/process-stores";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { datasetServer } from "../../dataset.server.ts";
import type { DatasetContent, DatasetNormalizeQueue } from "../dataset.app.ts";
import {
  createDatasetTestAuthz,
  createDatasetTestEntitlement,
  createDatasetTestExperiments,
  createDatasetTestProjects,
} from "./dataset.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(datasetServer)])
    .withStores(memoryStores())
    .withMember("publicBaseUrl", undefined)
    .withMember("content", createApiFixture<DatasetContent>())
    .withMember("queue", createApiFixture<DatasetNormalizeQueue>())
    .provide({
      experiment: createDatasetTestExperiments(),
      authz: createDatasetTestAuthz(),
      project: createDatasetTestProjects(),
      entitlement: createDatasetTestEntitlement(),
      "stored-object": createApiFixture<StoredObjectApi>(),
    });
}

const projectId = "project-1";

describe("dataset app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(DatasetApi);
      expect(runtime.module(datasetServer).provided).toBe(app);

      const created = await app.upsertDataset({
        projectId,
        name: "Nightly regression",
        columnTypes: [{ name: "input", type: "string" }],
      });

      await expect(app.getBySlugOrId({ projectId, slugOrId: created.slug })).resolves.toMatchObject(
        { id: created.id, name: "Nightly regression" },
      );

      await expect(
        app.getBySlugOrId({ projectId: "other-project", slugOrId: created.slug }),
      ).rejects.toBeInstanceOf(DatasetNotFoundError);

      await app.archiveDataset({ projectId, slugOrId: created.id });

      await expect(app.getBySlugOrId({ projectId, slugOrId: created.id })).rejects.toBeInstanceOf(
        DatasetNotFoundError,
      );
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      const created = await first
        .service(DatasetApi)
        .upsertDataset({ projectId, name: "Only here", columnTypes: [] });

      await expect(
        second.service(DatasetApi).getBySlugOrId({ projectId, slugOrId: created.id }),
      ).rejects.toBeInstanceOf(DatasetNotFoundError);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});
