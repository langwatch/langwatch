import type { ResolvedRetention } from "@langwatch/data-retention-contract";
import { TeamNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import {
  type CachedRetentionLookup,
  DataRetentionCacheRepository,
} from "../../repositories/data-retention-cache.repository.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "../../repositories/memory/memory.pinned-trace.repository.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import { RedisStorageMeterCacheRepository } from "../../repositories/redis/redis.storage-meter-cache.repository.ts";
import { STORAGE_METER_CACHE_TTL_MS } from "../../repositories/storage-meter-cache.repository.ts";
import { DataRetentionService } from "../data-retention.service.ts";
import { StorageMeterService } from "../storage-meter.service.ts";

/** These cases never meter: a read reaching ClickHouse is the test failing. */
function refusingClickHouse() {
  return clickHouseQueryClientDouble({
    query: async () => {
      throw new Error("storage metering is not part of this case");
    },
  });
}

const DEFAULT_DAYS = 49;
const PROJECT = retentionTestGraph.projectId;
const ORGANIZATION = retentionTestGraph.organizationId ?? "organization-1";

/** Records what a write invalidated, which is what the cascade has to reach. */
class RecordingCache extends DataRetentionCacheRepository {
  readonly values = new Map<string, ResolvedRetention>();
  readonly deleted: string[] = [];

  async get(key: string): Promise<CachedRetentionLookup> {
    const value = this.values.get(key);
    return value === undefined ? { kind: "miss" } : { kind: "hit", value };
  }

  async set(key: string, value: ResolvedRetention): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.values.delete(key);
  }
}

function createService(
  input: Readonly<{
    policies?: MemoryDataRetentionRepository;
    cache?: DataRetentionCacheRepository;
    projects?: ProjectApi;
    organizations?: OrganizationApi;
    retroactive?: MemoryRetroactiveRetentionRepository;
  }> = {},
) {
  return DataRetentionService.create({
    policies: input.policies ?? MemoryDataRetentionRepository.create(),
    pins: MemoryPinnedTraceRepository.create(),
    projects: input.projects ?? createDataRetentionTestProjects(),
    organizations: input.organizations ?? createDataRetentionTestOrganizations(),
    defaultRetentionDays: DEFAULT_DAYS,
    retroactive: input.retroactive ?? MemoryRetroactiveRetentionRepository.create(),
    cache: input.cache ?? new RecordingCache(),
    storageMeter: StorageMeterService.create({
      clickhouse: refusingClickHouse(),
      cache: RedisStorageMeterCacheRepository.create({ ttlMs: STORAGE_METER_CACHE_TTL_MS }),
    }),
  });
}

describe("DataRetentionService", () => {
  describe("given a rewrite was asked for", () => {
    /**
     * The store is never absent: a deployment with no ClickHouse refuses at
     * boot naming this module. So a rewrite asked for reports as in progress
     * until killed, rather than "nothing is running" for lack of a store.
     */
    it("reports it as in progress until it is killed", async () => {
      const service = createService();

      await expect(
        service.triggerRetroactiveUpdate({
          projectId: PROJECT,
          category: "traces",
          newRetentionDays: DEFAULT_DAYS,
        }),
      ).resolves.toMatchObject({ tables: expect.any(Array) });

      const progress = await service.getRetroactiveMutationProgress({ projectId: PROJECT });
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.every((mutation) => mutation.category === "traces")).toBe(true);

      for (const mutation of progress) {
        await service.killRetroactiveMutation({
          projectId: PROJECT,
          mutationId: mutation.mutationId,
        });
      }

      await expect(service.getRetroactiveMutationProgress({ projectId: PROJECT })).resolves.toEqual(
        [],
      );
    });
  });

  describe("when a rule is set above the project", () => {
    /** @scenario "Resolve retention through the scope cascade" */
    it("resolves policy through the project/team/organization cascade", async () => {
      const policies = MemoryDataRetentionRepository.create();
      await policies.upsertForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
        retentionDays: 63,
      });

      const service = createService({ policies });

      await expect(
        service.getRetentionDays({ projectId: PROJECT, category: "traces" }),
      ).resolves.toBe(63);
    });
  });

  describe("when the value is not a whole number of weeks", () => {
    /** @scenario "Reject invalid retention values" */
    it("rejects unaligned retention values at the service boundary", async () => {
      const service = createService();

      await expect(
        service.setForScope({
          scope: { scopeType: "PROJECT", scopeId: PROJECT },
          category: "traces",
          retentionDays: 42,
        }),
      ).rejects.toThrow(/only available as a fixed plan option/);
    });
  });

  describe("given a project with no resolvable scope", () => {
    /** @scenario "Default a missing read target" */
    it("keeps the platform default", async () => {
      const service = createService();

      await expect(service.getResolvedForProject({ projectId: "missing" })).resolves.toEqual({
        traces: DEFAULT_DAYS,
        scenarios: DEFAULT_DAYS,
        experiments: DEFAULT_DAYS,
      });
      await expect(
        service.previewScopeRemoval({ scope: { scopeType: "PROJECT", scopeId: "missing" } }),
      ).resolves.toEqual({
        traces: DEFAULT_DAYS,
        scenarios: DEFAULT_DAYS,
        experiments: DEFAULT_DAYS,
      });
    });
  });

  describe("when a rule is written at a scope that no longer exists", () => {
    /** @scenario "A retention rule aimed at a scope that no longer exists is refused by name" */
    it("refuses by name rather than writing an unanchored rule", async () => {
      const service = createService();

      await expect(
        service.setForScope({
          scope: { scopeType: "PROJECT", scopeId: "missing" },
          category: "traces",
          retentionDays: 49,
        }),
      ).rejects.toMatchObject({
        code: "data_retention_scope_target_not_found",
        httpStatus: 404,
        isHandled: true,
      });
    });
  });

  describe("when the organization directory answers a team lookup", () => {
    /** @scenario "Resolve scope ownership through canonical services" */
    it("defaults a genuinely missing team but does not hide service failures", async () => {
      const missing = createService({
        organizations: createApiFixture<OrganizationApi>({
          getTeamById: async () => {
            throw new TeamNotFoundError("missing");
          },
        }),
      });

      await expect(
        missing.previewScopeRemoval({ scope: { scopeType: "TEAM", scopeId: "missing" } }),
      ).resolves.toEqual({
        traces: DEFAULT_DAYS,
        scenarios: DEFAULT_DAYS,
        experiments: DEFAULT_DAYS,
      });

      const unavailable = new Error("organization service unavailable");
      const failing = createService({
        organizations: createApiFixture<OrganizationApi>({
          getTeamById: async () => {
            throw unavailable;
          },
        }),
      });

      await expect(
        failing.previewScopeRemoval({
          scope: { scopeType: "TEAM", scopeId: retentionTestGraph.teamId },
        }),
      ).rejects.toBe(unavailable);
    });
  });

  describe("when a rule is written at the organization", () => {
    it("invalidates every affected project's resolved policy after writes", async () => {
      const cache = new RecordingCache();
      const service = createService({
        cache,
        projects: createDataRetentionTestProjects(retentionTestGraph, ["project-2"]),
      });

      await service.setForScope({
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
        retentionDays: 63,
      });
      await service.removeForScope({
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
      });

      expect(cache.deleted).toEqual([PROJECT, "project-2", PROJECT, "project-2"]);
    });
  });

  describe("given the organization holds its hidden governance project", () => {
    async function governanceAwareProjects(): Promise<ProjectApi> {
      const application = await createDataRetentionTestProjects().findWithTeam(PROJECT);
      if (!application) throw new Error("the retention fixture seeds its project");
      const governance = { ...application, id: "project-governance", kind: "internal_governance" };
      const visible = (includeGovernance: boolean | undefined) =>
        includeGovernance ? [application, governance] : [application];

      return createApiFixture<ProjectApi>({
        listByTeam: async ({ includeGovernance }) => visible(includeGovernance),
        listByOrganization: async ({ includeGovernance }) => {
          const data = visible(includeGovernance);
          return { data, pagination: { page: 1, limit: data.length, total: data.length } };
        },
      });
    }

    /** @scenario "An organization or team retention rule reaches the governance project" */
    it("invalidates the governance project for organization and team rules", async () => {
      const cache = new RecordingCache();
      const service = createService({ cache, projects: await governanceAwareProjects() });

      await service.setForScope({
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
        retentionDays: 63,
      });
      await service.setForScope({
        scope: { scopeType: "TEAM", scopeId: retentionTestGraph.teamId },
        category: "traces",
        retentionDays: 63,
      });

      expect(cache.deleted).toEqual([PROJECT, "project-governance", PROJECT, "project-governance"]);
    });
  });
});
