/**
 * @vitest-environment node
 * @integration
 *
 * AC37 (issue #4133) — "The dataset-content backfill task migrates a
 * postgres-layout dataset onto azure".
 *
 * Exercises the REAL production wiring end-to-end: `migrateDatasetToS3` with
 * `resolveStorage: resolveProjectStorageDestination` and
 * `getStorage: getDatasetStorage` (the real dispatcher, unmocked) — only the
 * env boundary is stubbed (STORED_OBJECTS_BACKEND=azure + AZURE_BLOB_* aimed
 * at a real Azurite testcontainer) and the BYOC lookup (no per-project bucket
 * for this test project). Everything from "env says azure" through
 * "AzureDatasetStorage writes chunk objects to Azurite" is real.
 *
 * Uses a real Postgres (via `~/server/db`, same as
 * `dataset.repository.integration.test.ts`) for the Dataset/DatasetRecord
 * rows and the per-dataset advisory lock `migrateDatasetToS3` takes.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));
vi.mock("~/env.mjs", () => ({ env: mockEnv }));
vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn(async () => null),
}));

import { nanoid } from "nanoid";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { DatasetRecordRepository } from "../../server/datasets/dataset-record.repository";
import { getDatasetStorage } from "../../server/datasets/dataset-storage";
import {
  ensureAzuriteContainer,
  type StartedAzurite,
  startAzurite,
  stopAzurite,
} from "../../server/stored-objects/__tests__/azurite-test-support";
import { resolveProjectStorageDestination } from "../../server/stored-objects/project-storage-destination";
import {
  type BackfillDeps,
  migrateDatasetToS3,
} from "../backfillDatasetContentToS3";

const CONTAINER = "datasets";

let azurite: StartedAzurite;
let organization: Organization;
let team: Team;
let project: Project;

beforeAll(async () => {
  azurite = await startAzurite();
  await ensureAzuriteContainer({ azurite, container: CONTAINER });

  mockEnv.STORED_OBJECTS_BACKEND = "azure";
  mockEnv.AZURE_BLOB_ACCOUNT_NAME = azurite.accountName;
  mockEnv.AZURE_BLOB_ACCOUNT_KEY = azurite.accountKey;
  mockEnv.AZURE_BLOB_CONTAINER = CONTAINER;
  mockEnv.AZURE_BLOB_ENDPOINT = azurite.endpointBaseUrl;
}, 60_000);

afterAll(async () => {
  await stopAzurite(azurite);
}, 30_000);

beforeEach(async () => {
  organization = await prisma.organization.create({
    data: { name: "Test Org", slug: `test-org-${nanoid()}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Test Team",
      slug: `test-team-${nanoid()}`,
      organizationId: organization.id,
    },
  });
  project = await prisma.project.create({
    data: {
      ...projectFactory.build({ slug: nanoid() }),
      teamId: team.id,
      personalFeatures: {},
    },
  });
});

afterEach(async () => {
  await prisma.datasetRecord.deleteMany({ where: { projectId: project.id } });
  await prisma.dataset.deleteMany({ where: { projectId: project.id } });
  await prisma.project.delete({ where: { id: project.id } });
  await prisma.team.delete({ where: { id: team.id } });
  await prisma.organization.delete({ where: { id: organization.id } });
});

describe("migrateDatasetToS3 onto the Azure Blob backend", () => {
  describe("given a dataset whose content still lives in the postgres layout", () => {
    /** @scenario "The dataset-content backfill task migrates a postgres-layout dataset onto azure" */
    it("writes chunked JSONL to Azure Blob and flips contentLayout to chunked", async () => {
      const dataset = await prisma.dataset.create({
        data: {
          name: "Postgres Dataset",
          slug: `pg-ds-${nanoid()}`,
          projectId: project.id,
          columnTypes: [],
          contentLayout: "postgres",
        },
      });
      const entries = [{ a: 1 }, { a: 2 }, { a: 3 }];
      // Distinct createdAt per row: the production read order is
      // [createdAt asc, id asc], and rows created in the same millisecond
      // with random ids would come back in nondeterministic order.
      const baseTime = Date.now();
      for (const [i, entry] of entries.entries()) {
        await prisma.datasetRecord.create({
          data: {
            id: `record_${nanoid()}`,
            datasetId: dataset.id,
            projectId: project.id,
            entry,
            createdAt: new Date(baseTime + i * 1000),
          },
        });
      }

      const deps: BackfillDeps = {
        prisma,
        recordRepository: new DatasetRecordRepository(prisma),
        resolveStorage: resolveProjectStorageDestination,
        getStorage: getDatasetStorage,
      };

      const outcome = await migrateDatasetToS3(
        { dataset, projectId: project.id },
        deps,
      );

      expect(outcome).toBe("migrated");

      const updated = await prisma.dataset.findFirstOrThrow({
        where: { id: dataset.id, projectId: project.id },
      });
      expect(updated.contentLayout).toBe("s3_jsonl");
      expect(updated.rowCount).toBe(3);
      expect(updated.chunkCount).toBeGreaterThan(0);

      // Reading back through the real dispatcher (getDatasetStorage) proves
      // the migrated content is actually retrievable via the production read
      // path, not just that SOME bytes landed somewhere.
      const storage = await getDatasetStorage(project.id);
      const rows = await storage.readChunks({
        projectId: project.id,
        datasetId: dataset.id,
        chunkCount: updated.chunkCount!,
      });
      const readEntries = (rows as { entry: unknown }[]).map((r) => r.entry);
      expect(readEntries).toEqual(entries);
    });
  });
});
