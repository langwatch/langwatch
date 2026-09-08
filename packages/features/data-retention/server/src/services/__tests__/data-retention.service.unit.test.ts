import { TeamNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ResolvedRetention } from "@langwatch/data-retention-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import {
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "../../repositories/memory/memory.pinned-trace.repository.ts";
import { DataRetentionCacheStore } from "../../stores/data-retention-cache.store.ts";
import { DataRetentionService } from "../data-retention.service.ts";
import { StorageMeterService } from "../storage-meter.service.ts";

const DEFAULT_DAYS = 49;
const PROJECT = retentionTestGraph.projectId;
const ORGANIZATION = retentionTestGraph.organizationId ?? "organization-1";

/** Records what a write invalidated, which is what the cascade has to reach. */
class RecordingCache extends DataRetentionCacheStore {
  readonly values = new Map<string, ResolvedRetention>();
  readonly deleted: string[] = [];

  async tryGet(key: string): Promise<ResolvedRetention | undefined> {
    return this.values.get(key);
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
    cache?: DataRetentionCacheStore;
    projects?: ProjectApi;
    organizations?: OrganizationApi;
  }> = {},
) {
  return DataRetentionService.create({
    policies: input.policies ?? MemoryDataRetentionRepository.create(),
    pins: MemoryPinnedTraceRepository.create(),
    projects: input.projects ?? createDataRetentionTestProjects(),
    organizations: input.organizations ?? createDataRetentionTestOrganizations(),
    defaultRetentionDays: DEFAULT_DAYS,
    retroactive: null,
    cache: input.cache ?? new RecordingCache(),
    storageMeter: StorageMeterService.create({ resolveClickHouseClient: null }),
  });
}

describe("DataRetentionService", () => {
  describe("given no ClickHouse was composed", () => {
    it("refuses a retroactive rewrite and answers no progress", async () => {
      const service = createService();

      await expect(
        service.triggerRetroactiveUpdate({
          projectId: PROJECT,
          category: "traces",
          newRetentionDays: DEFAULT_DAYS,
        }),
      ).rejects.toThrow("ClickHouse not available");
      await expect(service.getRetroactiveMutationProgress({ projectId: PROJECT })).resolves.toEqual(
        [],
      );
      await expect(
        service.killRetroactiveMutation({ projectId: PROJECT, mutationId: "mutation" }),
      ).resolves.toBeUndefined();
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
});
