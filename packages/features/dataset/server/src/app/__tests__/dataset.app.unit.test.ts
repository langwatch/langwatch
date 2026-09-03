/**
 * @vitest-environment node
 *
 * The dataset application: the one rule that moved off its four doors onto it.
 *
 * A create-or-replace can arrive INCOMPLETE — naming the dataset by slug
 * rather than id, naming an experiment instead of a name, or naming neither a
 * name nor the columns because it is patching what already exists. Both doors
 * had a fill of their own for that hole: the tRPC door borrowed the name of
 * the experiment the caller named, the REST patch borrowed the name and
 * columns of the dataset it was replacing. "What a partial upsert means" was
 * therefore decided in two places and could answer differently the first time
 * one moved.
 *
 * The services are stubbed. Nothing here speaks HTTP or tRPC.
 */
import type { Dataset, DatasetService } from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";
import { DatasetApp, type DatasetExperimentLookup } from "../dataset.app";

const replacing = {
  id: "dataset_existing",
  name: "Original",
  slug: "original",
  columnTypes: [{ name: "input", type: "string" }],
} as unknown as Dataset;

function harness({
  dataset = {},
  experiments = {},
}: {
  dataset?: Record<string, unknown>;
  experiments?: Record<string, unknown>;
} = {}) {
  const datasetService = {
    getBySlugOrId: vi.fn(async () => replacing),
    upsertDataset: vi.fn(async () => replacing),
    ...dataset,
  } as unknown as DatasetService;

  const experimentLookup = {
    getById: vi.fn(async () => ({ name: "Nightly regression" })),
    tryGetBySlug: vi.fn(async () => ({ id: "experiment-1" })),
    ...experiments,
  } as unknown as DatasetExperimentLookup;

  return {
    dataset: datasetService,
    experiments: experimentLookup,
    app: DatasetApp.create({ dataset: datasetService, experiments: experimentLookup }),
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
        experiments: { getById: vi.fn(async () => ({ name: null })) },
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

  describe("when a page holds only the slug of a batch evaluation's experiment", () => {
    it("turns it into the id those records are keyed by", async () => {
      const { app, experiments } = harness();

      await expect(
        app.tryGetExperimentBySlug({ projectId: "project-1", slug: "nightly" }),
      ).resolves.toEqual({ id: "experiment-1" });
      expect(experiments.tryGetBySlug).toHaveBeenCalledWith({
        projectId: "project-1",
        slug: "nightly",
      });
    });

    it("answers null when the project has no experiment by that slug", async () => {
      const { app } = harness({ experiments: { tryGetBySlug: vi.fn(async () => null) } });

      await expect(
        app.tryGetExperimentBySlug({ projectId: "project-1", slug: "ghost" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a caller names its own byte budget for a whole-dataset read", () => {
    it("passes it through rather than substituting one of the application's", async () => {
      const { app, dataset } = harness({
        dataset: {
          getDatasetWithRecords: vi.fn(async () => ({ dataset: replacing, records: [] })),
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
});
