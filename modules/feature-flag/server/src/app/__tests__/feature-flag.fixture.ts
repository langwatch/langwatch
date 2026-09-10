import type { AuthzApi } from "@langwatch/authz-contract";
import {
  FEATURE_FLAG_REGISTRY,
  resolveFeatureFlagConfig,
  type FeatureFlagConfig,
  type FeatureFlagRegistry,
} from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Instant } from "@langwatch/time";
import {
  FeatureFlagCacheRepository,
  type FeatureFlagCacheSlot,
} from "../../repositories/feature-flag-cache.repository.ts";
import type { FeatureFlagRepositories } from "../../repositories/feature-flag.repositories.ts";
import { MemoryFeatureFlagExperimentRepository } from "../../repositories/memory/memory.feature-flag-experiment-setting.repository.ts";
import { MemoryFeatureFlagRepositories } from "../../repositories/memory/memory.feature-flag.repositories.ts";
import { MemoryFeatureFlagRepository } from "../../repositories/memory/memory.feature-flag.repository.ts";
import { FeatureFlagService } from "../../services/feature-flag.service.ts";
import { OrganizationCreatedAtCacheService } from "../../services/organization-created-at-cache.service.ts";
import { CachedFeatureFlagRowAdapter } from "../../adapters/cached.feature-flag-row.adapter.ts";
import { FeatureFlagApp } from "../feature-flag.app.ts";

/** Shared cache tier held in process, for tests that need no Redis. */
export class MemoryFeatureFlagCache extends FeatureFlagCacheRepository {
  private readonly slots = new Map<string, FeatureFlagCacheSlot>();

  async findSlot(key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return this.slots.get(key);
  }

  async set(key: string, slot: FeatureFlagCacheSlot): Promise<void> {
    this.slots.set(key, slot);
  }

  async delete(key: string): Promise<void> {
    this.slots.delete(key);
  }
}

/**
 * The organization directory as the age rule reads it: creation dates seeded
 * by the test, a read counter, and a one-shot failure for the blip the rule
 * must fail closed on.
 */
export class TestOrganizations {
  private readonly createdAt = new Map<string, Instant>();
  /** How many times an age rule sent the resolver to the organizations. */
  organizationReads = 0;
  private failNextRead = false;

  static create(): TestOrganizations {
    return new TestOrganizations();
  }

  rememberOrganization({
    organizationId,
    createdAt,
  }: {
    organizationId: string;
    createdAt: Instant;
  }): void {
    this.createdAt.set(organizationId, createdAt);
  }

  failNextOrganizationLookup(): void {
    this.failNextRead = true;
  }

  api(overrides: Partial<OrganizationApi> = {}): OrganizationApi {
    return createApiFixture<OrganizationApi>({
      findProvisioningSummary: async (organizationId: string) => {
        this.organizationReads += 1;
        if (this.failNextRead) {
          this.failNextRead = false;
          throw new Error("connection reset");
        }
        const createdAt = this.createdAt.get(organizationId);

        return createdAt
          ? { id: organizationId, name: organizationId, slug: organizationId, createdAt }
          : null;
      },
      memberOrganizationIds: async ({ organizationIds }) => organizationIds,
      ...overrides,
    });
  }
}

export function createFeatureFlagTestProjects(organizationId = "organization-1"): ProjectApi {
  return createApiFixture<ProjectApi>({ getOrganizationId: async () => organizationId });
}

export function createFeatureFlagTestAuthz(permitted = true): AuthzApi {
  return createApiFixture<AuthzApi>({ hasPermission: async () => permitted });
}

/**
 * The real service graph over in-process collaborators, so resolver tests
 * exercise the same code path production runs.
 */
export function createFeatureFlagTestService(options?: {
  config?: FeatureFlagConfig;
  now?: () => number;
  registry?: FeatureFlagRegistry;
}): {
  service: FeatureFlagService;
  repository: MemoryFeatureFlagRepository;
  experiments: MemoryFeatureFlagExperimentRepository;
  cache: MemoryFeatureFlagCache;
  organizations: TestOrganizations;
} {
  const now = options?.now ?? Date.now;
  const repository = MemoryFeatureFlagRepository.create(now);
  const experiments = MemoryFeatureFlagExperimentRepository.create();
  const cache = new MemoryFeatureFlagCache();
  const organizations = TestOrganizations.create();
  const service = FeatureFlagService.create({
    repository,
    rows: CachedFeatureFlagRowAdapter.create({ repository, cache, now }),
    experiments,
    config: options?.config ?? resolveFeatureFlagConfig({}),
    registry: options?.registry ?? FEATURE_FLAG_REGISTRY,
    organizationAges: OrganizationCreatedAtCacheService.create({
      organizations: organizations.api(),
    }),
  });

  return { service, repository, experiments, cache, organizations };
}

/** The app over memory repositories and fixture peers. */
export function createFeatureFlagTestApp(
  input: Readonly<{
    repositories?: FeatureFlagRepositories;
    config?: FeatureFlagConfig;
    cache?: FeatureFlagCacheRepository;
    dependencies?: Partial<{
      permissions: AuthzApi;
      projects: ProjectApi;
      organizations: OrganizationApi;
    }>;
  }> = {},
): FeatureFlagApp {
  return FeatureFlagApp.create({
    repositories: input.repositories ?? MemoryFeatureFlagRepositories.create(),
    infrastructure: {
      cache: input.cache ?? new MemoryFeatureFlagCache(),
      config: input.config ?? resolveFeatureFlagConfig({}),
    },
    dependencies: {
      permissions: input.dependencies?.permissions ?? createFeatureFlagTestAuthz(),
      projects: input.dependencies?.projects ?? createFeatureFlagTestProjects(),
      organizations: input.dependencies?.organizations ?? TestOrganizations.create().api(),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
