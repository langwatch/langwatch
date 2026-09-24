import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { Experiment, ExperimentApi } from "@langwatch/experiment-contract";
import { ResourceScope } from "@langwatch/kernel";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import { memoryObjectStorage } from "@langwatch/process-stores";
import type { ObjectStorage } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { vi } from "vitest";

import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetAttachmentReferenceService } from "../../services/dataset-attachment-reference.service.ts";
import { DatasetRequestBoundsService } from "../../services/dataset-request-bounds.service.ts";
import type { DatasetInfrastructure } from "../dataset.app.ts";
import { DatasetApp } from "../dataset.app.ts";

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

export function createDatasetTestProjects(organizationId = "organization-1"): ProjectApi {
  return Object.assign(createApiFixture<ProjectApi>(), {
    getOrganizationId: vi.fn(async () => organizationId),
  });
}

const TIER_PLAN_TYPE = {
  free: "FREE",
  paid: "PRO",
  enterprise: "ENTERPRISE",
} as const;

/**
 * The entitlement peer answering every request bound on one tier. Suites that
 * assert tier behavior pick the tier; the rest take the free default, the
 * same answer an absent entitlement resolves.
 */
export function createDatasetTestEntitlement(
  tier: keyof typeof TIER_PLAN_TYPE = "free",
): EntitlementApi {
  return createApiFixture<EntitlementApi>({
    requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
      Promise.resolve(resolveRequestBound(key, TIER_PLAN_TYPE[tier])),
  });
}

/**
 * The request-bound collaborator a `DatasetService` test constructs directly
 * with, answering every bound on one tier.
 */
export function createDatasetTestRequestBounds(
  tier: keyof typeof TIER_PLAN_TYPE = "free",
): DatasetRequestBoundsService {
  return DatasetRequestBoundsService.create({
    entitlement: createDatasetTestEntitlement(tier),
    projects: createDatasetTestProjects(),
  });
}

/** The reference check a `DatasetService` test constructs with; unscripted reads throw by name. */
export function createDatasetTestAttachments(
  storedObjects: StoredObjectApi = createApiFixture<StoredObjectApi>({}, "storedObjects"),
): DatasetAttachmentReferenceService {
  return DatasetAttachmentReferenceService.create({ storedObjects });
}

export function createDatasetTestApp(
  input: Readonly<{
    repositories?: DatasetRepositories;
    members?: DatasetInfrastructure;
    objectStorage?: ObjectStorage;
    publicBaseUrl?: string;
    dependencies?: Partial<{
      experiments: ExperimentApi;
      permissions: AuthzApi;
      projects: ProjectApi;
      entitlement: EntitlementApi;
      storedObjects: StoredObjectApi;
    }>;
  }> = {},
): DatasetApp {
  return DatasetApp.create({
    repositories: input.repositories ?? MemoryDatasetRepositories.create(),
    dependencies: {
      experiments: input.dependencies?.experiments ?? createDatasetTestExperiments(),
      permissions: input.dependencies?.permissions ?? createDatasetTestAuthz(),
      projects: input.dependencies?.projects ?? createDatasetTestProjects(),
      entitlement: input.dependencies?.entitlement ?? createDatasetTestEntitlement(),
      storedObjects:
        input.dependencies?.storedObjects ?? createApiFixture<StoredObjectApi>({}, "storedObjects"),
    },
    members: {
      ...input.members,
      objectStorage: input.objectStorage ?? memoryObjectStorage(),
      publicBaseUrl: input.publicBaseUrl,
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: {} as never,
  });
}
