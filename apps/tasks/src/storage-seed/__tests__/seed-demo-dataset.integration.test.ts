/**
 * @vitest-environment node
 * The demo platform's sample dataset, seeded through the dataset module booted over its memory
 * stores: its rows are in object storage and none are in the records table.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { datasetProcessModule } from "@langwatch/dataset-process";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedDemoDataset } from "../seed-demo-dataset.ts";

const projectId = "project-demo";

let runtime: Awaited<ReturnType<typeof bootInstalledProcess>>;

beforeEach(async () => {
  runtime = await bootInstalledProcess({
    role: "worker",
    modules: [datasetProcessModule],
    config: { dataset: { publicBaseUrl: undefined } },
    stores: memoryStores(),
    peers: [
      testPeer({
        token: AuthzApi,
        instance: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      }),
      testPeer({
        token: ProjectApi,
        instance: createApiFixture<ProjectApi>({
          getOrganizationId: async () => "organization-demo",
        }),
      }),
      testPeer({
        token: EntitlementApi,
        instance: createApiFixture<EntitlementApi>({
          requestBound: async ({ key }) => resolveRequestBound(key, "FREE"),
        }),
      }),
      testPeer({ token: StoredObjectApi, instance: createApiFixture<StoredObjectApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
    ],
  });
});

afterEach(async () => {
  await runtime.stop();
});

describe("when the demo platform is seeded", () => {
  /** @scenario "The demo platform seed creates its sample dataset in object storage" */
  it("keeps the sample dataset's rows in object storage and none in the records table", async () => {
    const datasets = runtime.service(DatasetApi);

    const seeded = await seedDemoDataset({ datasets, projectId });

    const [stored] = await datasets.listStoragePage({ projectId, limit: 10 });
    expect(stored).toMatchObject({ id: seeded.id, contentLayout: "s3_jsonl" });
    const read = await datasets.getDatasetWithRecords({
      projectId,
      slugOrId: seeded.id,
      limitMb: null,
    });
    expect(read.records.map((record) => record.id)).toEqual([
      "demo-dataset-record-1",
      "demo-dataset-record-2",
      "demo-dataset-record-3",
      "demo-dataset-record-4",
      "demo-dataset-record-5",
    ]);
    expect(read.records[0]?.entry).toMatchObject({ category: "billing" });
    await expect(datasets.countUsage({ projectIds: [projectId] })).resolves.toMatchObject({
      datasets: 1,
      datasetRecords: 0,
    });
  });

  /** @scenario "The demo platform seed creates its sample dataset in object storage" */
  it("finds the sample dataset again on a second run instead of adding another", async () => {
    const datasets = runtime.service(DatasetApi);

    const first = await seedDemoDataset({ datasets, projectId });
    const second = await seedDemoDataset({ datasets, projectId });

    expect(second.id).toBe(first.id);
    await expect(datasets.countUsage({ projectIds: [projectId] })).resolves.toMatchObject({
      datasets: 1,
    });
  });
});
