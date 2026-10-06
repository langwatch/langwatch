import type { AgentApi } from "@langwatch/agent-contract";
import type { Dataset, DatasetApi, DatasetRecord } from "@langwatch/dataset-contract";
import { ExperimentEvaluationInputError } from "@langwatch/experiment-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * The bounds a run's data load holds: inline rows answer the plan's inline row
 * bound; a saved dataset answers the dataset row and whole-read byte bounds.
 * @see specs/experiments-v3/execution-inputs.feature
 */
import { describe, expect, it } from "vitest";

import {
  ExperimentExecutionDataService,
  type ExperimentWorkflowDsl,
} from "../experiment-execution-data.service.ts";

const PROJECT_ID = "project-1";
const DATASET_ID = "dataset-1";
const KB = 1024;
const MB = 1024 * KB;

type Tier = "free" | "paid" | "enterprise";
type Bounds = Partial<Record<RequestBoundKey, number>>;

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ row: index }));

/** A saved dataset served the two ways a run reads one: its head, then its pages. */
function savedDataset(entries: Record<string, unknown>[]) {
  const at = new Date(0);
  const dataset: Dataset = {
    id: DATASET_ID,
    projectId: PROJECT_ID,
    name: "Saved",
    slug: "saved",
    columnTypes: [{ name: "row", type: "number" }],
    createdAt: at,
    updatedAt: at,
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
  const records = (): DatasetRecord[] =>
    entries.map((entry, index) => ({
      id: `record-${index}`,
      datasetId: DATASET_ID,
      projectId: PROJECT_ID,
      entry,
      createdAt: at,
      updatedAt: at,
    }));
  const pagesRead: { page: number; limit: number }[] = [];
  const api = createApiFixture<DatasetApi>({
    getDatasetHead: async () => ({
      dataset,
      records: records().slice(0, 5),
      total: entries.length,
    }),
    getDatasetPage: async ({ page = 1, limit = 50 }) => {
      pagesRead.push({ page, limit });
      const all = records();

      return {
        id: DATASET_ID,
        name: "Saved",
        columnTypes: dataset.columnTypes,
        datasetRecords: all.slice((page - 1) * limit, page * limit),
        count: all.length,
        page,
        limit,
        totalPages: Math.ceil(all.length / limit),
      };
    },
  });

  return { api, entries, pagesRead };
}

function services({
  tier = "free",
  datasets = createApiFixture<DatasetApi>(),
  bounds = {},
}: { tier?: Tier; datasets?: DatasetApi; bounds?: Bounds } = {}) {
  const planType = { free: "FREE", paid: "PRO", enterprise: "ENTERPRISE" }[tier];
  return {
    datasets,
    prompts: createApiFixture<PromptApi>(),
    agents: createApiFixture<AgentApi>(),
    workflows: createApiFixture<ExperimentWorkflowDsl>(),
    entitlements: {
      requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
        Promise.resolve(bounds[key] ?? resolveRequestBound(key, planType)),
    },
    projects: {
      getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
    },
  };
}

const loadInline = (
  tier: Tier,
  rowCount: number,
): ReturnType<ExperimentExecutionDataService["loadExecutionData"]> =>
  ExperimentExecutionDataService.create().loadExecutionData({
    projectId: PROJECT_ID,
    dataset: { type: "inline", columns: [] },
    targets: [],
    evaluators: [],
    services: services({ tier }),
    inputs: { data: rows(rowCount) },
  });

const loadSaved = ({
  datasets,
  bounds,
  tier,
  byReference = false,
}: {
  datasets: DatasetApi;
  bounds?: Bounds;
  tier?: Tier;
  /** The run names the dataset through the workbench's saved reference, not a dataset id input. */
  byReference?: boolean;
}): ReturnType<ExperimentExecutionDataService["loadExecutionData"]> =>
  ExperimentExecutionDataService.create().loadExecutionData({
    projectId: PROJECT_ID,
    dataset: byReference
      ? { type: "saved", datasetId: DATASET_ID, columns: [{ id: "row", name: "row", type: "number" }] }
      : { type: "inline", columns: [] },
    targets: [],
    evaluators: [],
    services: services({ datasets, ...(bounds ? { bounds } : {}), ...(tier ? { tier } : {}) }),
    inputs: byReference ? {} : { datasetId: DATASET_ID },
  });

describe("loadExecutionData bounds", () => {
  describe("given rows sent with the request", () => {
    describe("when they are above the plan's inline row bound", () => {
      /** @scenario "Inline rows above the plan's inline row limit are refused naming that limit" */
      it.each([
        ["free", 1001, 1000],
        ["paid", 2001, 2000],
        ["enterprise", 4001, 4000],
      ] as const)(
        "refuses %i rows to a %s-tier caller with the tier number in the error",
        async (tier, count, bound) => {
          const refusal = loadInline(tier, count);
          await expect(refusal).rejects.toBeInstanceOf(ExperimentEvaluationInputError);
          await expect(refusal).rejects.toMatchObject({
            code: "experiment_evaluation_too_many_rows",
            httpStatus: 422,
            message: expect.stringMatching(new RegExp(`${count}.*${bound}`)),
          });
        },
      );

      it("refuses rows the transport schema allowed: 3000 rows read as a free caller", async () => {
        // 3000 parses under the enterprise ceiling of 4000; a free plan still
        // refuses it at the load, which the schema cannot see.
        await expect(loadInline("free", 3000)).rejects.toMatchObject({ httpStatus: 422 });
      });
    });

    describe("when they are exactly at the plan's inline row bound", () => {
      it("loads every row", async () => {
        const result = await loadInline("paid", 2000);
        expect(result.datasetRows).toHaveLength(2000);
      });
    });
  });

  describe("given a saved dataset", () => {
    describe("when its rows total far more than one inline response carries", () => {
      /** @scenario "A saved dataset larger than one inline response runs every row" */
      it("loads all 40 rows of 200 KB, in order", async () => {
        const saved = savedDataset(
          Array.from({ length: 40 }, (_, index) => ({ row: index, image: "x".repeat(200 * KB) })),
        );

        const result = await loadSaved({ datasets: saved.api });

        expect(result.datasetRows).toHaveLength(40);
        expect(result.datasetRows.map((row) => row.row)).toEqual(
          Array.from({ length: 40 }, (_, index) => index),
        );
        // Pages are sized to the rows: large rows are asked for a few at a time.
        expect(saved.pagesRead.every((page) => page.limit <= 40)).toBe(true);
      });
    });

    describe("when it has more rows than the plan sends inline", () => {
      /** @scenario "A saved dataset with more rows than the plan sends inline runs every row" */
      it.each([[false], [true]])(
        "loads all 2,500 rows on the free plan (named by workbench reference: %s)",
        async (byReference) => {
          const saved = savedDataset(rows(2500));

          const result = await loadSaved({ datasets: saved.api, tier: "free", byReference });

          expect(result.datasetRows).toHaveLength(2500);
          expect(result.datasetRows.at(-1)).toMatchObject({ row: 2499 });
        },
      );
    });

    describe("when it has more rows than one run reads", () => {
      /** @scenario "A saved dataset above the dataset row limit is refused before its rows are read" */
      it("refuses with the row limit and reads no page", async () => {
        const saved = savedDataset(rows(11));

        await expect(
          loadSaved({ datasets: saved.api, bounds: { datasetRowsMax: 10 } }),
        ).rejects.toMatchObject({
          code: "experiment_dataset_too_many_rows",
          httpStatus: 422,
          meta: { rowCount: 11, maxRows: 10 },
        });
        expect(saved.pagesRead).toEqual([]);
      });

      it("holds the registry's 100,000 row limit when the organization sets nothing", () => {
        expect(resolveRequestBound("datasetRowsMax", "FREE")).toBe(100_000);
      });
    });

    describe("when its rows total more bytes than the organization's whole-dataset limit", () => {
      /** @scenario "A saved dataset whose rows total more than a run holds is refused" */
      it("refuses with the byte limit instead of running the rows that fit", async () => {
        const saved = savedDataset(
          Array.from({ length: 30 }, (_, index) => ({ row: index, image: "x".repeat(100 * KB) })),
        );

        await expect(
          loadSaved({ datasets: saved.api, bounds: { datasetWholeReadBytes: 2 * MB } }),
        ).rejects.toMatchObject({
          code: "experiment_dataset_too_large_to_run",
          httpStatus: 413,
          meta: { maxBytes: 2 * MB },
        });
      });
    });

    describe("when the organization's limit was raised above the default", () => {
      /** @scenario "An organization with a raised file limit runs a dataset the default limit refuses" */
      it("loads a dataset the lower limit refuses", async () => {
        const entries = Array.from({ length: 30 }, (_, index) => ({
          row: index,
          image: "x".repeat(100 * KB),
        }));

        await expect(
          loadSaved({
            datasets: savedDataset(entries).api,
            bounds: { datasetWholeReadBytes: 2 * MB },
          }),
        ).rejects.toMatchObject({ code: "experiment_dataset_too_large_to_run" });
        const raised = await loadSaved({
          datasets: savedDataset(entries).api,
          bounds: { datasetWholeReadBytes: 8 * MB },
        });

        expect(raised.datasetRows).toHaveLength(30);
      });
    });

    describe("when rows are removed while the run is reading it", () => {
      /** @scenario "A saved dataset that changes while the run reads it is refused instead of run short" */
      it("refuses instead of running the rows that were left", async () => {
        const saved = savedDataset(rows(2500));
        const readPage = saved.api.getDatasetPage.bind(saved.api);
        saved.api.getDatasetPage = async (input) => {
          if ((input.page ?? 1) === 2) saved.entries.splice(0, 600);

          return readPage(input);
        };

        await expect(loadSaved({ datasets: saved.api })).rejects.toMatchObject({
          code: "experiment_dataset_changed_during_read",
          httpStatus: 409,
        });
      });
    });
  });
});
