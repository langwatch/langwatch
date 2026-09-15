/**
 * @vitest-environment node
 *
 * The dataset feature, booted the way a process boots it: over the memory
 * repositories, with the two peers it declares, in every role it serves.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { DatasetApi, DatasetNotFoundError } from "@langwatch/dataset-contract";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";

import { datasetServer } from "../../dataset.server.ts";
import { createDatasetTestAuthz, createDatasetTestExperiments } from "./dataset.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role, config: {} })
    .withProvided(ExperimentApi, createDatasetTestExperiments())
    .withProvided(AuthzApi, createDatasetTestAuthz())
    .withModules([withMemoryRepositories(datasetServer)]);
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
