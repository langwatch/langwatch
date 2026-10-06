/**
 * @vitest-environment node
 *
 * The dataset feature, booted the way a process boots it: over the memory
 * repositories, with the two peers it declares, in every role it serves.
 */
import type { FeatureRestHost, FeatureTrpcHost } from "@langwatch/api";
import { DatasetApi, DatasetNotFoundError } from "@langwatch/dataset-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { datasetProcessModule } from "../../dataset.module.ts";
import {
  createDatasetTestAuthz,
  createDatasetTestEntitlement,
  createDatasetTestExperiments,
  createDatasetTestProjects,
} from "./dataset.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([datasetProcessModule])
    .withStores(memoryStores())
    .withConfig({ dataset: { publicBaseUrl: undefined } })
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
      expect(runtime.module(datasetProcessModule).provided).toBe(app);

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

describe("dataset transports installation", () => {
  /** A door that keeps the app thunk each declaration was mounted with. */
  const keepingApp: FeatureRestHost<{ app: () => unknown }> &
    FeatureTrpcHost<{ app: () => unknown }> = { mount: (_declaration, app) => ({ app }) };

  /** @scenario "Compatibility transports share one service" */
  it("hands every REST and tRPC declaration the process's one Dataset service, on every request", async () => {
    const runtime = await process("api")
      .expose(() => ({ hosts: { rest: keepingApp, trpc: keepingApp }, serve: () => undefined }))
      .boot();

    try {
      const shared = runtime.service(DatasetApi);
      const mounted = [...runtime.transports.rest, ...Object.values(runtime.transports.trpc)];

      expect(Object.keys(runtime.transports.trpc).toSorted()).toEqual([
        "batchRecord",
        "dataset",
        "datasetRecord",
      ]);
      expect(runtime.transports.rest).toHaveLength(1);
      for (const transport of mounted) {
        const first = transport.app();
        const second = transport.app();

        expect(first).toBe(shared);
        expect(second).toBe(shared);
      }
    } finally {
      await runtime.stop();
    }
  });
});
