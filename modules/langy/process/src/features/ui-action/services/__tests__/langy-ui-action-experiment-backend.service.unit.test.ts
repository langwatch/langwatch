import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LangyUiActionExperimentBackendService } from "../langy-ui-action-experiment-backend.service.ts";

const projection = {
  source: "saved" as const,
  version: 7,
  name: "My experiment",
  activeDatasetId: "dataset_1",
  datasets: [],
  targets: [],
  evaluators: [],
};

describe("LangyUiActionExperimentBackendService.project", () => {
  it("reads the saved board through experiment's projection, with the version it was read at", async () => {
    const asked: unknown[] = [];
    const backend = LangyUiActionExperimentBackendService.create({
      experiments: createApiFixture<ExperimentApi>({
        projectSavedWorkbench: async (input) => {
          asked.push(input);
          return projection;
        },
      }),
      projects: createApiFixture<Pick<ProjectApi, "findIdentity">>(),
    });

    const read = await backend.project({
      projectId: "project_1",
      target: "my-experiment",
      payload: { includeResults: false },
    });

    expect(asked).toStrictEqual([
      { projectId: "project_1", slug: "my-experiment", includeResults: false },
    ]);
    expect(read.version).toBe(7);
    expect(read.projection).toMatchObject({ name: "My experiment", datasets: [] });
  });

  it("answers an experiment with nothing saved as an empty board rather than refusing", async () => {
    const backend = LangyUiActionExperimentBackendService.create({
      experiments: createApiFixture<ExperimentApi>({
        projectSavedWorkbench: async () => ({ source: "saved", version: 0, state: null }),
      }),
      projects: createApiFixture<Pick<ProjectApi, "findIdentity">>(),
    });

    const read = await backend.project({ projectId: "project_1", target: "fresh", payload: {} });

    expect(read).toStrictEqual({ version: 0, projection: { source: "saved", state: null } });
  });
});
