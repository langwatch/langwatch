import type { WorkbenchStateView } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ExperimentWorkbenchVersionService } from "../experiment-workbench-version.service.ts";
import type { ExperimentService } from "../experiment.service.ts";

const workbench: WorkbenchStateView = {
  experimentId: "experiment_1",
  slug: "my-experiment",
  name: "My experiment",
  state: null,
  version: 3,
  updatedAt: new Date("2026-09-24T10:00:00.000Z"),
};

const actor = { userId: "user_1", label: "user" } as const;

describe("ExperimentWorkbenchVersionService.restoreBySlug", () => {
  it("restores the numbered version of the experiment the slug names", async () => {
    const restored: unknown[] = [];
    const service = ExperimentWorkbenchVersionService.create({
      experiments: createApiFixture<ExperimentService>({
        getWorkbenchState: async () => workbench,
        restoreWorkbenchVersion: async (input) => {
          restored.push(input);
          return { experimentId: "experiment_1", slug: "my-experiment", version: 4 };
        },
      }),
      workbenchTargetNames: async () => ({}),
    });

    const answer = await service.restoreBySlug({
      projectId: "project_1",
      slug: "my-experiment",
      version: 2,
      actor,
    });

    expect(answer.version).toBe(4);
    expect(restored).toStrictEqual([
      { projectId: "project_1", id: "experiment_1", version: 2, actor },
    ]);
  });

  /** @scenario "A restore of a version that does not exist reads as not found" */
  it("refuses a path segment that parsed as no version as a version never had", async () => {
    const service = ExperimentWorkbenchVersionService.create({
      experiments: createApiFixture<ExperimentService>({
        getWorkbenchState: async () => workbench,
      }),
      workbenchTargetNames: async () => ({}),
    });

    await expect(
      service.restoreBySlug({
        projectId: "project_1",
        slug: "my-experiment",
        version: 0,
        actor,
      }),
    ).rejects.toMatchObject({ code: "experiment_version_not_found" });
  });
});

const savedState: NonNullable<WorkbenchStateView["state"]> = {
  name: "My experiment",
  activeDatasetId: "dataset_1",
  datasets: [
    {
      id: "dataset_1",
      name: "Inline",
      type: "inline",
      columns: [{ id: "input", name: "input", type: "string" }],
      inline: {
        columns: [{ id: "input", name: "input", type: "string" }],
        records: { input: ["hi"] },
      },
    },
  ],
  evaluators: [],
  targets: [],
  results: {
    runId: "run_1",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
  },
};

describe("ExperimentWorkbenchVersionService.projectSavedBySlug", () => {
  it("projects the saved board with its results and the column names the platform resolved", async () => {
    const named: unknown[] = [];
    const service = ExperimentWorkbenchVersionService.create({
      experiments: createApiFixture<ExperimentService>({
        getWorkbenchState: async () => ({ ...workbench, state: savedState }),
      }),
      workbenchTargetNames: async (input) => {
        named.push(input);
        return {};
      },
    });

    const read = await service.projectSavedBySlug({
      projectId: "project_1",
      slug: "my-experiment",
    });

    expect(read).toMatchObject({ source: "saved", version: 3, name: "My experiment" });
    expect(read).toHaveProperty("results");
    expect(named).toStrictEqual([{ projectId: "project_1", targets: [] }]);
  });

  it("leaves the results out when the agent asks for the board alone", async () => {
    const service = ExperimentWorkbenchVersionService.create({
      experiments: createApiFixture<ExperimentService>({
        getWorkbenchState: async () => ({ ...workbench, state: savedState }),
      }),
      workbenchTargetNames: async () => ({}),
    });

    const read = await service.projectSavedBySlug({
      projectId: "project_1",
      slug: "my-experiment",
      includeResults: false,
    });

    expect(read).not.toHaveProperty("results");
  });

  it("answers an experiment with nothing saved yet as an empty board", async () => {
    const service = ExperimentWorkbenchVersionService.create({
      experiments: createApiFixture<ExperimentService>({
        getWorkbenchState: async () => workbench,
      }),
      workbenchTargetNames: async () => ({}),
    });

    const read = await service.projectSavedBySlug({
      projectId: "project_1",
      slug: "my-experiment",
    });

    expect(read).toStrictEqual({ source: "saved", version: 3, state: null });
  });
});
