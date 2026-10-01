/**
 * @vitest-environment node
 * Incomplete upserts can arrive, copy reads a second project (authorization
 * gap), services stubbed. HTTP/tRPC testing is elsewhere.
 */
import {
  DatasetNotFoundError,
  datasetPageSchema,
  type Dataset,
  type DatasetPage,
} from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";

import { DatasetService } from "../../services/dataset.service.ts";
import {
  createDatasetTestApp,
  createDatasetTestAuthz,
  createDatasetTestExperiments,
  datasetTestExperiment,
} from "./dataset.fixture.ts";

const replacing: Dataset = {
  id: "dataset_existing",
  projectId: "project-1",
  name: "Original",
  slug: "original",
  columnTypes: [{ name: "input", type: "string" }],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "postgres",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: null,
  sizeBytes: null,
  chunkCount: null,
  chunkOffsets: null,
};

function harness({
  dataset = {},
  experiments = createDatasetTestExperiments(),
  permissions = createDatasetTestAuthz(),
}: {
  dataset?: Partial<DatasetService>;
  experiments?: ReturnType<typeof createDatasetTestExperiments>;
  permissions?: ReturnType<typeof createDatasetTestAuthz>;
} = {}) {
  const datasetService = {
    getBySlugOrId: vi.fn(async () => replacing),
    upsertDataset: vi.fn(async () => replacing),
    copyDataset: vi.fn(async () => replacing),
    ...dataset,
  } satisfies Partial<DatasetService>;

  for (const name of ["getBySlugOrId", "upsertDataset", "copyDataset"] as const) {
    vi.spyOn(DatasetService.prototype, name).mockImplementation(datasetService[name]);
  }
  if (datasetService.getDatasetWithRecords) {
    vi.spyOn(DatasetService.prototype, "getDatasetWithRecords").mockImplementation(
      datasetService.getDatasetWithRecords,
    );
  }
  if (datasetService.getDatasetPage) {
    vi.spyOn(DatasetService.prototype, "getDatasetPage").mockImplementation(
      datasetService.getDatasetPage,
    );
  }

  return {
    dataset: datasetService,
    experiments,
    permissions,
    app: createDatasetTestApp({ dependencies: { experiments, permissions } }),
  };
}

/** The single argument a stubbed method was called with. */
function firstCall(method: unknown): Record<string, unknown> {
  const mock = method as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("DatasetApp", () => {
  describe("when an upsert names the row it is replacing by slug", () => {
    it("takes the name that patch did not send from that row", async () => {
      const { app, dataset } = harness();

      await app.upsertDataset({
        projectId: "project-1",
        slugOrId: "original",
        columnTypes: [{ name: "question", type: "string" }],
      });

      expect(dataset.getBySlugOrId).toHaveBeenCalledWith({
        projectId: "project-1",
        slugOrId: "original",
      });
      expect(firstCall(dataset.upsertDataset)).toMatchObject({
        projectId: "project-1",
        name: "Original",
        columnTypes: [{ name: "question", type: "string" }],
        datasetId: "dataset_existing",
      });
    });

    it("takes the columns that patch did not send from that row", async () => {
      const { app, dataset } = harness();

      await app.upsertDataset({
        projectId: "project-1",
        slugOrId: "original",
        name: "Renamed",
      });

      // A patch that sends one field must not blank the other.
      expect(firstCall(dataset.upsertDataset)).toMatchObject({
        name: "Renamed",
        columnTypes: [{ name: "input", type: "string" }],
      });
    });

    it("writes onto the id the caller gave rather than the one the slug resolved to", async () => {
      const { app, dataset } = harness();

      await app.upsertDataset({
        projectId: "project-1",
        slugOrId: "original",
        datasetId: "dataset_named",
        name: "Renamed",
      });

      expect(firstCall(dataset.upsertDataset).datasetId).toBe("dataset_named");
    });
  });

  describe("when an upsert names an experiment instead of a name", () => {
    it("borrows the experiment's name", async () => {
      const { app, dataset, experiments } = harness();

      await app.upsertDataset({ projectId: "project-1", experimentId: "experiment-1" });

      expect(experiments.getById).toHaveBeenCalledWith({
        projectId: "project-1",
        id: "experiment-1",
      });
      expect(firstCall(dataset.upsertDataset)).toMatchObject({
        name: "Nightly regression",
        columnTypes: [],
      });
    });

    it("keeps the name the caller did send, and never reads the experiment", async () => {
      const { app, dataset, experiments } = harness();

      await app.upsertDataset({
        projectId: "project-1",
        experimentId: "experiment-1",
        name: "Mine",
      });

      expect(experiments.getById).not.toHaveBeenCalled();
      expect(firstCall(dataset.upsertDataset).name).toBe("Mine");
    });

    it("refuses when the experiment it named has no name to lend", async () => {
      const { app, dataset } = harness({
        experiments: createDatasetTestExperiments(datasetTestExperiment(null)),
      });

      await expect(
        app.upsertDataset({ projectId: "project-1", experimentId: "experiment-1" }),
      ).rejects.toThrow("Experiment experiment-1 has no name");
      expect(dataset.upsertDataset).not.toHaveBeenCalled();
    });
  });

  describe("when an upsert names nothing to call the dataset", () => {
    it("refuses before the service is touched", async () => {
      const { app, dataset } = harness();

      await expect(app.upsertDataset({ projectId: "project-1" })).rejects.toThrow(
        "A dataset needs a name",
      );
      expect(dataset.upsertDataset).not.toHaveBeenCalled();
    });
  });

  describe("when an upsert names everything", () => {
    it("reads no row and borrows nothing", async () => {
      const { app, dataset, experiments } = harness();

      await app.upsertDataset({
        projectId: "project-1",
        name: "Brand New",
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(dataset.getBySlugOrId).not.toHaveBeenCalled();
      expect(experiments.getById).not.toHaveBeenCalled();
      expect(firstCall(dataset.upsertDataset)).toMatchObject({
        projectId: "project-1",
        name: "Brand New",
        columnTypes: [{ name: "input", type: "string" }],
      });
    });
  });

  describe("when a copy names a source project the caller may not read", () => {
    /** @scenario "A copy is refused when the source project is not the caller's" */
    it("refuses before the source dataset is read", async () => {
      const { app, dataset, permissions } = harness({ permissions: createDatasetTestAuthz(false) });

      await expect(
        app.copyDatasetForActor({
          actorId: "user-1",
          sourceDatasetId: "dataset-1",
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
        }),
      ).rejects.toMatchObject({ code: "permission_denied" });

      expect(permissions.hasPermission).toHaveBeenCalledWith({
        userId: "user-1",
        permission: "datasets:create",
        projectId: "project-source",
      });
      expect(dataset.copyDataset).not.toHaveBeenCalled();
    });

    it("copies into the target project once the source is permitted", async () => {
      const { app, dataset } = harness();

      await app.copyDatasetForActor({
        actorId: "user-1",
        sourceDatasetId: "dataset-1",
        sourceProjectId: "project-source",
        targetProjectId: "project-target",
      });

      expect(dataset.copyDataset).toHaveBeenCalledWith({
        sourceDatasetId: "dataset-1",
        sourceProjectId: "project-source",
        targetProjectId: "project-target",
      });
    });
  });

  describe("when a page holds only the slug of a batch evaluation's experiment", () => {
    it("turns it into the id those records are keyed by", async () => {
      const { app, experiments } = harness();

      await expect(
        app.listBatchEvaluations({ projectId: "project-1", experimentSlug: "nightly" }),
      ).resolves.toEqual([]);
      expect(experiments.findBySlug).toHaveBeenCalledWith({
        projectId: "project-1",
        slug: "nightly",
      });
    });

    it("refuses when the project has no experiment by that slug", async () => {
      const { app } = harness({ experiments: createDatasetTestExperiments(null) });

      await expect(
        app.listBatchEvaluations({ projectId: "project-1", experimentSlug: "ghost" }),
      ).rejects.toMatchObject({ code: "experiment_not_found" });
    });
  });

  describe("when a caller names its own byte budget for a whole-dataset read", () => {
    it("passes it through rather than substituting one of the application's", async () => {
      const { app, dataset } = harness({
        dataset: {
          getDatasetWithRecords: vi.fn(async () => ({
            dataset: replacing,
            records: [],
            truncated: false,
          })),
        },
      });

      await app.getDatasetWithRecords({
        slugOrId: "original",
        projectId: "project-1",
        limitMb: 25,
      });

      expect(firstCall(dataset.getDatasetWithRecords).limitMb).toBe(25);
    });
  });

  describe("when a selected dataset may have been removed", () => {
    it("returns the found dataset without changing it", async () => {
      const { app } = harness();

      await expect(
        app.findBySlugOrId({ projectId: "project-1", slugOrId: "original" }),
      ).resolves.toBe(replacing);
    });

    /** @scenario "An optional dataset lookup reports an unavailable selection" */
    it("returns null when the service reports an unavailable selection", async () => {
      const { app } = harness({
        dataset: {
          getBySlugOrId: vi.fn(async () => {
            throw new DatasetNotFoundError();
          }),
        },
      });

      await expect(
        app.findBySlugOrId({ projectId: "project-1", slugOrId: "gone" }),
      ).resolves.toBeNull();
    });

    /** @scenario "An optional dataset lookup reports an unavailable selection" */
    it("keeps an unexpected lookup failure observable", async () => {
      const unexpected = new Error("database unavailable");
      const { app } = harness({
        dataset: {
          getBySlugOrId: vi.fn(async () => {
            throw unexpected;
          }),
        },
      });

      await expect(
        app.findBySlugOrId({ projectId: "project-1", slugOrId: "original" }),
      ).rejects.toBe(unexpected);
    });
  });

  describe("when a selected dataset page may have been removed", () => {
    /** @scenario "An optional dataset page reports an unavailable selection" */
    it("returns a found page without changing its rows or count", async () => {
      const page: DatasetPage = datasetPageSchema.parse({
        id: "dataset-1",
        name: "Golden set",
        columnTypes: [{ name: "input", type: "string" }],
        datasetRecords: [
          {
            id: "record-2",
            datasetId: "dataset-1",
            projectId: "project-1",
            entry: { input: "second" },
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
          {
            id: "record-1",
            datasetId: "dataset-1",
            projectId: "project-1",
            entry: { input: "first" },
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
        count: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
      });
      const { app } = harness({
        dataset: { getDatasetPage: vi.fn(async (): Promise<DatasetPage> => page) },
      });

      await expect(
        app.findDatasetPage({ projectId: "project-1", slugOrId: "original", page: 2, limit: 2 }),
      ).resolves.toBe(page);
    });

    /** @scenario "An optional dataset page reports an unavailable selection" */
    it("returns null when the page service reports an unavailable dataset", async () => {
      const { app } = harness({
        dataset: {
          getDatasetPage: vi.fn(async () => {
            throw new DatasetNotFoundError();
          }),
        },
      });

      await expect(
        app.findDatasetPage({ projectId: "project-1", slugOrId: "gone", page: 1, limit: 50 }),
      ).resolves.toBeNull();
    });

    /** @scenario "An optional dataset page reports an unavailable selection" */
    it("keeps an unexpected page failure observable", async () => {
      const unexpected = new Error("record store unavailable");
      const { app } = harness({
        dataset: {
          getDatasetPage: vi.fn(async () => {
            throw unexpected;
          }),
        },
      });

      await expect(
        app.findDatasetPage({ projectId: "project-1", slugOrId: "original", page: 1, limit: 50 }),
      ).rejects.toBe(unexpected);
    });
  });
});
