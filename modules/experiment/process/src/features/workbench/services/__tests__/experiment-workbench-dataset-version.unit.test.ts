/**
 * A saved run reads one version of its saved dataset and records it against the run.
 * @see modules/dataset/specs/dataset-versioning.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import {
  type Dataset,
  type DatasetApi,
  type DatasetVersion,
  type DatasetVersionAuthor,
  DatasetVersionNotFoundError,
} from "@langwatch/dataset-contract";
import type { Experiment, WorkbenchCredential } from "@langwatch/experiment-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { ExperimentWorkflowDsl } from "../../../../services/experiment-execution-data.service.ts";
import type { ExperimentService } from "../../../../services/experiment.service.ts";
import type { ExperimentWorkbenchObserver } from "../experiment-workbench-observer.service.ts";
import type { WorkbenchRunPipeline } from "../experiment-workbench-pipeline-run.service.ts";
import { ExperimentWorkbenchRunService } from "../experiment-workbench-run.service.ts";

const PROJECT_ID = "project-1";
const DATASET_ID = "dataset-1";
const EXPERIMENT_ID = "experiment-1";
const SLUG = "support-eval";
const AT = new Date(0);

type Row = Record<string, unknown>;

const DATASET: Dataset = {
  id: DATASET_ID,
  projectId: PROJECT_ID,
  name: "Questions",
  slug: "questions",
  columnTypes: [{ name: "question", type: "string" }],
  createdAt: AT,
  updatedAt: AT,
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

/** A saved dataset with a version history, answering the reads and links a run makes. */
class VersionedDataset {
  current: Row[];
  readonly versions: { version: DatasetVersion; rows: Row[] }[] = [];
  readonly resolved: { version?: number; by: DatasetVersionAuthor }[] = [];
  readonly read: number[] = [];
  readonly links: { runId: string; experimentId?: string | null; versionId: string }[] = [];
  failLinks = false;

  constructor(current: Row[]) {
    this.current = current;
  }

  save({ rows, trigger }: { rows: Row[]; trigger: DatasetVersion["trigger"] }): DatasetVersion {
    const number = this.versions.length + 1;
    const version: DatasetVersion = {
      id: `version-${number}`,
      projectId: PROJECT_ID,
      datasetId: DATASET_ID,
      version: number,
      name: null,
      trigger,
      contentHash: JSON.stringify(rows),
      columnTypes: [{ name: "question", type: "string" }],
      rowCount: rows.length,
      sizeBytes: 0,
      chunkCount: 1,
      restoredFromVersion: null,
      authorId: null,
      authorKind: "system",
      pinned: false,
      runCount: 0,
      createdAt: AT,
    };
    this.versions.push({ version, rows: [...rows] });
    return version;
  }

  api(): DatasetApi {
    return createApiFixture<DatasetApi>({
      getDatasetHead: async () => ({
        dataset: DATASET,
        records: [],
        total: this.current.length,
      }),
      resolveVersionForRun: async ({ version, by }) => {
        this.resolved.push({ ...(version !== undefined ? { version } : {}), by });
        if (version !== undefined) {
          const pinned = this.versions.find((saved) => saved.version.version === version);
          if (!pinned) throw new DatasetVersionNotFoundError({ version });
          return pinned.version;
        }
        const latest = this.versions.at(-1);
        if (latest && latest.version.contentHash === JSON.stringify(this.current)) {
          return latest.version;
        }
        return this.save({ rows: this.current, trigger: "experiment_run" });
      },
      readVersion: async ({ version }) => {
        const found = this.versions.find((saved) => saved.version.version === version);
        if (!found) throw new DatasetVersionNotFoundError({ version });
        this.read.push(version);
        return {
          version: found.version,
          rows: found.rows.map((entry, index) => ({ id: `row-${index}`, entry })),
        };
      },
      linkRunVersions: async ({ runId, experimentId, versions }) => {
        if (this.failLinks) throw new Error("link store down");
        for (const { versionId } of versions) this.links.push({ runId, experimentId, versionId });
      },
    });
  }
}

const savedExperiment = ({ datasetVersion }: { datasetVersion?: number } = {}): Experiment => ({
  id: EXPERIMENT_ID,
  projectId: PROJECT_ID,
  slug: SLUG,
  name: "Support eval",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: AT,
  updatedAt: AT,
  archivedAt: null,
  workbenchVersion: 0,
  workbenchState: {
    name: "Support eval",
    datasets: [
      {
        id: "ds-ref",
        name: "Questions",
        type: "saved",
        datasetId: DATASET_ID,
        ...(datasetVersion !== undefined ? { datasetVersion } : {}),
        columns: [{ id: "question", name: "question", type: "string" }],
      },
    ],
    activeDatasetId: "ds-ref",
    evaluators: [],
    targets: [],
  },
});

function harness({
  dataset,
  datasetVersion,
}: {
  dataset: VersionedDataset;
  datasetVersion?: number;
}) {
  const started: { runId: string; total: number }[] = [];
  const runs: WorkbenchRunPipeline = {
    commands: createApiFixture<WorkbenchRunPipeline["commands"]>({
      startExperimentRun: async (start) => {
        started.push({ runId: start.runId, total: start.total });
      },
    }),
    stream: createApiFixture<WorkbenchRunPipeline["stream"]>(),
    folds: createApiFixture<WorkbenchRunPipeline["folds"]>({ recordRunStart: async () => {} }),
    abort: createApiFixture<WorkbenchRunPipeline["abort"]>(),
    publicBaseUrl: "https://app.example.test",
    services: {
      datasets: dataset.api(),
      prompts: createApiFixture<PromptApi>(),
      agents: createApiFixture<AgentApi>(),
      workflows: createApiFixture<ExperimentWorkflowDsl>(),
      entitlements: {
        requestBound: async ({ key }) => resolveRequestBound(key, "ENTERPRISE"),
      },
      projects: { getOrganizationId: async () => "organization-1" },
    },
    ownership: { assertConnectedAgentsRunnable: async () => {} },
    concurrency: 4,
    refusals: {},
  };
  const experiments = createApiFixture<ExperimentService>({
    findBySlugAndType: async () =>
      savedExperiment(datasetVersion !== undefined ? { datasetVersion } : {}),
  });
  const service = ExperimentWorkbenchRunService.create({
    experiments,
    observer: createApiFixture<ExperimentWorkbenchObserver>(),
    runs,
  });
  const run = ({
    body = "",
    credential = { kind: "apiKey", userId: "user-1" },
  }: { body?: string; credential?: WorkbenchCredential } = {}) =>
    service.startSavedRun({
      projectId: PROJECT_ID,
      projectSlug: "project",
      slug: SLUG,
      body,
      acceptsEvents: false,
      credential,
    });

  return { run, started };
}

const questions = (...names: string[]): Row[] => names.map((question) => ({ question }));

describe("given a saved experiment over a saved dataset", () => {
  describe("when its content changed since the latest version and no version is pinned", () => {
    /** @scenario "An experiment run records the dataset version it ran on" */
    it("saves a version for the run, reads exactly its rows and links it to the run", async () => {
      const dataset = new VersionedDataset(questions("a", "b"));
      dataset.save({ rows: questions("a"), trigger: "manual" });
      const { run, started } = harness({ dataset });

      const answer = await run();

      expect(dataset.versions).toHaveLength(2);
      expect(dataset.versions[1]?.version.trigger).toBe("experiment_run");
      expect(dataset.resolved).toEqual([{ by: { kind: "user", id: "user-1" } }]);
      // Only the saved version is read; the dataset's live pages are never asked for.
      expect(dataset.read).toEqual([2]);
      expect(answer).toMatchObject({ kind: "started", status: "running" });
      const runId = answer.kind === "started" ? answer.runId : undefined;
      expect(started).toEqual([{ runId, total: 0 }]);
      expect(dataset.links).toEqual([
        { runId, experimentId: EXPERIMENT_ID, versionId: "version-2" },
      ]);
    });
  });

  describe("when the experiment pins version 1", () => {
    /** @scenario "An experiment run can pin a dataset version" */
    it("reads version 1, not the current content, and links version 1 to the run", async () => {
      const dataset = new VersionedDataset(questions("a", "b", "c"));
      dataset.save({ rows: questions("a"), trigger: "manual" });
      dataset.save({ rows: questions("a", "b"), trigger: "manual" });
      const { run } = harness({ dataset, datasetVersion: 1 });

      const answer = await run();

      expect(dataset.resolved).toEqual([{ version: 1, by: { kind: "user", id: "user-1" } }]);
      expect(dataset.versions).toHaveLength(2);
      expect(dataset.read).toEqual([1]);
      const runId = answer.kind === "started" ? answer.runId : undefined;
      expect(dataset.links).toEqual([
        { runId, experimentId: EXPERIMENT_ID, versionId: "version-1" },
      ]);
    });
  });

  describe("when the run pins a version the dataset does not have", () => {
    /** @scenario "Pinning a version the dataset does not have refuses the run" */
    it("refuses the run with dataset_version_not_found and starts nothing", async () => {
      const dataset = new VersionedDataset(questions("a", "b"));
      dataset.save({ rows: questions("a"), trigger: "manual" });
      dataset.save({ rows: questions("a", "b"), trigger: "manual" });
      const { run, started } = harness({ dataset, datasetVersion: 5 });

      await expect(run()).rejects.toMatchObject({
        code: "dataset_version_not_found",
        httpStatus: 404,
      });
      expect(started).toEqual([]);
      expect(dataset.links).toEqual([]);
    });
  });

  describe("when the run API is called with dataset_version 1", () => {
    /** @scenario "The run API takes a dataset version" */
    it("reads version 1's rows over the version the experiment pins", async () => {
      const dataset = new VersionedDataset(questions("a", "b", "c"));
      dataset.save({ rows: questions("a"), trigger: "manual" });
      dataset.save({ rows: questions("a", "b"), trigger: "manual" });
      const { run } = harness({ dataset, datasetVersion: 2 });

      await run({ body: JSON.stringify({ dataset_version: 1 }) });

      expect(dataset.resolved.map((call) => call.version)).toEqual([1]);
      expect(dataset.read).toEqual([1]);
      expect(dataset.links.map((link) => link.versionId)).toEqual(["version-1"]);
    });

    it("refuses a dataset_version sent with inline data", async () => {
      const dataset = new VersionedDataset(questions("a"));
      const { run } = harness({ dataset });

      await expect(
        run({ body: JSON.stringify({ data: questions("x"), dataset_version: 1 }) }),
      ).rejects.toMatchObject({ code: "experiment_evaluation_input_invalid" });
      expect(dataset.resolved).toEqual([]);
    });
  });

  describe("when linking the version fails", () => {
    it("still starts the run", async () => {
      const dataset = new VersionedDataset(questions("a"));
      dataset.failLinks = true;
      const { run, started } = harness({ dataset });

      await expect(run()).resolves.toMatchObject({ kind: "started" });
      expect(started).toHaveLength(1);
    });
  });

  describe("when a legacy project key runs it", () => {
    it("attributes the version it saves to the key", async () => {
      const dataset = new VersionedDataset(questions("a"));
      const { run } = harness({ dataset });

      await run({ credential: { kind: "legacyProjectKey" } });

      expect(dataset.resolved).toEqual([{ by: { kind: "api_key", id: null } }]);
    });
  });
});
