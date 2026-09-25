import { createApiFixture } from "@langwatch/api-fixture";
import type { WorkbenchStateView } from "@langwatch/experiment-contract";
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

  it("refuses a path segment that parsed as no version as a version never had", async () => {
    const service = ExperimentWorkbenchVersionService.create({
      experiments: createApiFixture<ExperimentService>({
        getWorkbenchState: async () => workbench,
      }),
    });

    await expect(
      service.restoreBySlug({
        projectId: "project_1",
        slug: "my-experiment",
        version: undefined,
        actor,
      }),
    ).rejects.toMatchObject({ code: "experiment_version_not_found" });
  });
});
