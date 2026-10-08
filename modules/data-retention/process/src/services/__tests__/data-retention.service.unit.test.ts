import type { ResolvedRetention } from "@langwatch/data-retention-contract";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestProjectScopes,
  retentionTestGraph,
  retentionTestScopeRow,
} from "../../app/__tests__/data-retention.fixture.ts";
import { ClickHouseStorageMeterRepository } from "../../repositories/clickhouse/clickhouse.storage-meter.repository.ts";
import {
  type CachedRetentionLookup,
  DataRetentionCacheRepository,
} from "../../repositories/data-retention-cache.repository.ts";
import { MemoryDataRetentionProjectScopeRepository } from "../../repositories/memory/memory.data-retention-project-scope.repository.ts";
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
    projectScopes?: MemoryDataRetentionProjectScopeRepository;
    retroactive?: MemoryRetroactiveRetentionRepository;
  }> = {},
) {
  return DataRetentionService.create({
    policies: input.policies ?? MemoryDataRetentionRepository.create(),
    pins: MemoryPinnedTraceRepository.create(),
    projectScopes: input.projectScopes ?? createDataRetentionTestProjectScopes(),
    defaultRetentionDays: DEFAULT_DAYS,
    retroactive: input.retroactive ?? MemoryRetroactiveRetentionRepository.create(),
    cache: input.cache ?? new RecordingCache(),
    storageMeter: StorageMeterService.create({
      meter: ClickHouseStorageMeterRepository.create({ clickhouse: refusingClickHouse() }),
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
          organizationId: ORGANIZATION,
          scope: { scopeType: "PROJECT", scopeId: PROJECT },
          category: "traces",
          retentionDays: 42,
        }),
      ).rejects.toThrow(/only available as a fixed plan option/);
    });
  });

  describe("given a project with no row in project's table", () => {
    /** @scenario "A project with no row is refused, and the refusal is never cached" */
    it("refuses it as not found, caches nothing, and resolves its rules once its row exists", async () => {
      const cache = new RecordingCache();
      const projectScopes = MemoryDataRetentionProjectScopeRepository.create();
      const policies = MemoryDataRetentionRepository.create();
      await policies.upsertForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
        retentionDays: 63,
      });
      const service = createService({ cache, projectScopes, policies });

      await expect(service.getResolvedForProject({ projectId: PROJECT })).rejects.toMatchObject({
        code: "project_not_found",
      });
      expect(cache.values.size).toBe(0);

      projectScopes.putProject(retentionTestScopeRow(PROJECT));
      await expect(
        service.getRetentionDays({ projectId: PROJECT, category: "traces" }),
      ).resolves.toBe(63);
    });

    /** @scenario "Default a missing removal preview" */
    it("previews the platform default for a project it does not know", async () => {
      const service = createService();

      await expect(
        service.previewScopeRemoval({
          organizationId: ORGANIZATION,
          scope: { scopeType: "PROJECT", scopeId: "missing" },
        }),
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
          organizationId: ORGANIZATION,
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

  describe("when a scope names a team", () => {
    /** @scenario "Resolve scope ownership through canonical services" */
    it("places the team in an organization from the team's own row", async () => {
      const service = createService();
      const team = { scopeType: "TEAM", scopeId: retentionTestGraph.teamId } as const;
      const unknown = { scopeType: "TEAM", scopeId: "team-without-row" } as const;

      await expect(
        service.assertScopeInOrganization({ organizationId: ORGANIZATION, scope: team }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertScopeInOrganization({ organizationId: "organization-other", scope: team }),
      ).rejects.toMatchObject({ code: "data_retention_scope_target_not_found" });
      await expect(
        service.previewScopeRemoval({
          organizationId: ORGANIZATION,
          scope: unknown,
        }),
      ).resolves.toEqual({
        traces: DEFAULT_DAYS,
        scenarios: DEFAULT_DAYS,
        experiments: DEFAULT_DAYS,
      });
    });
  });

  describe("when a write names a project with no row", () => {
    /** @scenario "Reject a missing write target" */
    it("refuses it as a missing scope target", async () => {
      await expect(
        createService().setForScope({
          organizationId: ORGANIZATION,
          scope: { scopeType: "PROJECT", scopeId: "project-without-row" },
          category: "traces",
          retentionDays: 63,
        }),
      ).rejects.toMatchObject({ code: "data_retention_scope_target_not_found" });
    });
  });

  describe("when a rule is written at the organization", () => {
    it("invalidates every affected project's resolved policy after writes", async () => {
      const cache = new RecordingCache();
      const service = createService({
        cache,
        projectScopes: createDataRetentionTestProjectScopes(retentionTestGraph, ["project-2"]),
      });

      await service.setForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
        retentionDays: 63,
      });
      await service.removeForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
      });

      expect(cache.deleted).toEqual([PROJECT, "project-2", PROJECT, "project-2"]);
    });
  });

  describe("given the organization holds its hidden governance project", () => {
    /** @scenario "An organization or team retention rule reaches the governance project" */
    it("invalidates the governance project for organization and team rules", async () => {
      const cache = new RecordingCache();
      // The governance project has a Project row like any other, so the placement reader holds it.
      const projectScopes = createDataRetentionTestProjectScopes(retentionTestGraph, [
        "project-governance",
      ]);
      const service = createService({ cache, projectScopes });

      await service.setForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION },
        category: "traces",
        retentionDays: 63,
      });
      await service.setForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: "TEAM", scopeId: retentionTestGraph.teamId },
        category: "traces",
        retentionDays: 63,
      });

      expect(cache.deleted).toEqual([PROJECT, "project-governance", PROJECT, "project-governance"]);
    });
  });
});

describe("given placement read from project's and organization's rows", () => {
  const TEAM = retentionTestGraph.teamId;

  async function rulesOn(
    rules: readonly { scopeType: "ORGANIZATION" | "TEAM"; scopeId: string; days: number }[],
  ) {
    const policies = MemoryDataRetentionRepository.create();
    for (const rule of rules) {
      await policies.upsertForScope({
        organizationId: ORGANIZATION,
        scope: { scopeType: rule.scopeType, scopeId: rule.scopeId },
        category: "traces",
        retentionDays: rule.days,
      });
    }
    return policies;
  }

  describe("when a project that existed before the deploy is first resolved", () => {
    /** @scenario "An existing project resolves retention on the first request after deploy" */
    it("resolves through the project, its team and organisation with nothing replayed", async () => {
      const policies = await rulesOn([{ scopeType: "TEAM", scopeId: TEAM, days: 70 }]);
      const service = createService({
        policies,
        projectScopes: MemoryDataRetentionProjectScopeRepository.create({
          projects: [retentionTestScopeRow(PROJECT)],
        }),
      });

      await expect(service.getResolvedForProject({ projectId: PROJECT })).resolves.toMatchObject({
        traces: 70,
      });
    });
  });

  describe("when the project's row names the team it was moved to", () => {
    /** @scenario "A moved project resolves under the team its row names now" */
    it("applies the rule on the new team", async () => {
      const moved = { ...retentionTestGraph, teamId: "team-moved-to" };
      const policies = await rulesOn([
        { scopeType: "TEAM", scopeId: TEAM, days: 70 },
        { scopeType: "TEAM", scopeId: moved.teamId, days: 91 },
      ]);
      const projectScopes = MemoryDataRetentionProjectScopeRepository.create({
        projects: [retentionTestScopeRow(PROJECT)],
      });
      projectScopes.putProject(retentionTestScopeRow(PROJECT, moved));

      await expect(
        createService({ policies, projectScopes }).getResolvedForProject({ projectId: PROJECT }),
      ).resolves.toMatchObject({ traces: 91 });
    });
  });

  describe("when a team holds no project yet", () => {
    /** @scenario "A team is placed in its organisation by its own row" */
    it("places the team by its own row and refuses it in another organisation", async () => {
      const empty = { scopeType: "TEAM", scopeId: "team-empty" } as const;
      const service = createService({
        projectScopes: MemoryDataRetentionProjectScopeRepository.create({
          teams: [{ teamId: empty.scopeId, organizationId: ORGANIZATION }],
        }),
      });

      await expect(
        service.assertScopeInOrganization({ organizationId: ORGANIZATION, scope: empty }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertScopeInOrganization({ organizationId: "organization-other", scope: empty }),
      ).rejects.toMatchObject({ code: "data_retention_scope_target_not_found" });
    });
  });
});
