import type { AuthzApi } from "@langwatch/authz-contract";
import type { Experiment, ExperimentApi } from "@langwatch/experiment-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import type { DatasetInfrastructure } from "../dataset.app.ts";
import { DatasetApp } from "../dataset.app.ts";
import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";

/** One experiment, as this feature reads it: a name to borrow and an id. */
export function datasetTestExperiment(
  name: string | null,
  id = "experiment-1",
  slug = "nightly",
): Experiment {
  return {
    id,
    name,
    type: "BATCH_EVALUATION",
    slug,
    projectId: "project-1",
    workflowId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    workbenchState: null,
    workbenchVersion: 0,
  };
}

export function createDatasetTestExperiments(
  experiment: Experiment | null = datasetTestExperiment("Nightly regression"),
) {
  return Object.assign(createApiFixture<ExperimentApi>(), {
    getById: vi.fn(async () => experiment ?? datasetTestExperiment(null)),
    findBySlug: vi.fn(async () => experiment),
  });
}

export function createDatasetTestAuthz(permitted = true) {
  return Object.assign(createApiFixture<AuthzApi>(), {
    hasPermission: vi.fn(async () => permitted),
  });
}

export function createDatasetTestApp(
  input: Readonly<{
    repositories?: DatasetRepositories;
    infrastructure?: DatasetInfrastructure;
    dependencies?: Partial<{ experiments: ExperimentApi; permissions: AuthzApi }>;
  }> = {},
): DatasetApp {
  return DatasetApp.create({
    repositories: input.repositories ?? MemoryDatasetRepositories.create(),
    dependencies: {
      experiments: input.dependencies?.experiments ?? createDatasetTestExperiments(),
      permissions: input.dependencies?.permissions ?? createDatasetTestAuthz(),
    },
    infrastructure: input.infrastructure ?? {},
    config: void 0,
    resources: new ResourceScope(),
  });
}
