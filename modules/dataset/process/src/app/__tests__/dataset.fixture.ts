import type { AuthzApi } from "@langwatch/authz-contract";
import { DATASET_LIMIT_BOUND_KEYS, type DatasetLimits } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  deriveDatasetBounds,
  isDatasetDerivedBoundKey,
  resolveRequestBound,
  type RequestBoundKey,
} from "@langwatch/plans";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetAttachmentReferenceService } from "../../services/dataset-attachment-reference.service.ts";
import { DatasetAttachmentUploadService } from "../../services/dataset-attachment-upload.service.ts";
import { DatasetInlineAttachmentService } from "../../services/dataset-inline-attachment.service.ts";
import { DatasetRequestBoundsService } from "../../services/dataset-request-bounds.service.ts";
import { DatasetModule } from "../dataset.app.ts";

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

/**
 * The entitlement peer of an organization whose dataset limits differ from the
 * defaults, so a suite can reach a limit with a small file.
 */
export function createDatasetTestEntitlementWith(limits: Partial<DatasetLimits>): EntitlementApi {
  const named: Partial<Record<RequestBoundKey, number>> = Object.fromEntries(
    Object.entries(limits).map(([name, value]) => [
      DATASET_LIMIT_BOUND_KEYS[name as keyof DatasetLimits],
      value,
    ]),
  );

  return createApiFixture<EntitlementApi>({
    requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
      Promise.resolve(named[key] ?? resolveRequestBound(key, "FREE")),
  });
}

/** The request bounds a service test constructs with, on limits that differ from the defaults. */
export function createDatasetTestRequestBoundsWith(
  limits: Partial<DatasetLimits>,
): DatasetRequestBoundsService {
  return DatasetRequestBoundsService.create({
    entitlement: createDatasetTestEntitlementWith(limits),
    projects: createDatasetTestProjects(),
  });
}

/**
 * The entitlement peer of an installation where some organizations hold a
 * raised per-file limit, each answering the bounds derived from its own.
 */
export function createDatasetTestEntitlementPerOrganization(
  raised: Readonly<Record<string, number>>,
): EntitlementApi {
  return createApiFixture<EntitlementApi>({
    requestBound: ({ key, organizationId }: { key: RequestBoundKey; organizationId: string }) => {
      const attachmentBytes = raised[organizationId];
      if (attachmentBytes === undefined || !isDatasetDerivedBoundKey(key)) {
        return Promise.resolve(resolveRequestBound(key, "FREE"));
      }

      return Promise.resolve(deriveDatasetBounds(attachmentBytes)[key]);
    },
  });
}

/** The reference check a `DatasetService` test constructs with; unscripted reads throw by name. */
export function createDatasetTestAttachments(
  storedObjects: StoredObjectApi = createApiFixture<StoredObjectApi>({}, "storedObjects"),
): DatasetAttachmentReferenceService {
  return DatasetAttachmentReferenceService.create({ storedObjects });
}

/** The inline-file store a `DatasetService` test constructs with; unscripted stores throw. */
export function createDatasetTestInlineAttachments(
  storedObjects: StoredObjectApi = createApiFixture<StoredObjectApi>({}, "storedObjects"),
  requestBounds: Pick<DatasetRequestBoundsService, "limit"> = createDatasetTestRequestBounds(),
): DatasetInlineAttachmentService {
  return DatasetInlineAttachmentService.create({
    uploads: DatasetAttachmentUploadService.create({ storedObjects, requestBounds }),
  });
}

export function createDatasetTestApp(
  input: Readonly<{
    repositories?: DatasetRepositories;
    publicBaseUrl?: string;
    dependencies?: Partial<{
      permissions: AuthzApi;
      projects: ProjectApi;
      entitlement: EntitlementApi;
      storedObjects: StoredObjectApi;
    }>;
  }> = {},
): DatasetModule {
  return DatasetModule.create({
    repositories: input.repositories ?? MemoryDatasetRepositories.create(),
    dependencies: {
      permissions: input.dependencies?.permissions ?? createDatasetTestAuthz(),
      projects: input.dependencies?.projects ?? createDatasetTestProjects(),
      entitlement: input.dependencies?.entitlement ?? createDatasetTestEntitlement(),
      storedObjects:
        input.dependencies?.storedObjects ?? createApiFixture<StoredObjectApi>({}, "storedObjects"),
    },
    config: { publicBaseUrl: input.publicBaseUrl },
    resources: new ResourceScope(),
    secrets: {} as never,
  });
}
