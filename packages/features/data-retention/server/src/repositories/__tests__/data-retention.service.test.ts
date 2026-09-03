import { describe, expect, it } from "vitest";
import type {
  ResolvedRetention,
  RetentionPolicy,
} from "@langwatch/data-retention-contract";
import {
  TeamNotFoundError,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { ProjectService, ProjectWithTeam } from "@langwatch/project-contract";
import { DataRetentionRepository } from "../data-retention.repository";
import { DataRetentionService } from "../../services/data-retention.service";
import { PinnedTraceRepository } from "../pinned-trace.repository";
import { DataRetentionCacheStore } from "../../stores/data-retention-cache.store";

class Repository extends DataRetentionRepository {
  rows: RetentionPolicy[] = [];
  async findForProjectChain() {
    return this.rows;
  }
  async findAllInOrganization() {
    return this.rows;
  }
  async tryFindById() {
    return null;
  }
  async upsertForScope(input: {
    organizationId: string;
    scope: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };
    category: "traces" | "scenarios" | "experiments";
    retentionDays: number;
  }) {
    return {
      id: "policy",
      organizationId: input.organizationId,
      scopeType: input.scope.scopeType,
      scopeId: input.scope.scopeId,
      category: input.category,
      retentionDays: input.retentionDays,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  async deleteForScope() {}
}

class Cache extends DataRetentionCacheStore {
  values = new Map<string, ResolvedRetention>();
  deleted: string[] = [];
  async tryGet(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: ResolvedRetention) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.values.delete(key);
  }
}

class PinRepository extends PinnedTraceRepository {
  async tryFindByProjectAndTrace() {
    return null;
  }
  async findAllByProject() {
    return [];
  }
  async findAllTraceIds() {
    return [];
  }
  async create(input: any) {
    return {
      id: "pin",
      projectId: input.projectId,
      traceId: input.traceId,
      userId: input.userId ?? null,
      source: input.source,
      reason: input.reason ?? null,
      createdAt: new Date(),
    };
  }
  async delete() {}
  async hasManualPin() {
    return false;
  }
}

const project = {
  id: "project",
  teamId: "team",
  team: { organizationId: "org" },
} as ProjectWithTeam;

const projects = {
  getWithTeam: async () => project,
  tryGetWithTeam: async () => project,
  listByTeam: async () => [project],
  listByOrganization: async () => ({
    data: [project, { ...project, id: "project_2" }],
    pagination: { page: 1, limit: 10_000, total: 2 },
  }),
} as unknown as ProjectService;

const organizations = {
  getTeamById: async () => ({ id: "team", organizationId: "org" }),
} as unknown as OrganizationService;

const createService = (repository = new Repository(), cache?: Cache) =>
  DataRetentionService.create({
    repository,
    projects,
    organizations,
    defaultRetentionDays: 49,
    pinRepository: new PinRepository(),
    cache,
  });

describe("DataRetentionService", () => {
  it("preserves unavailable ClickHouse behaviour", async () => {
    const service = createService();

    await expect(
      service.triggerRetroactiveUpdate({
        projectId: "project",
        category: "traces",
        newRetentionDays: 49,
      }),
    ).rejects.toThrow("ClickHouse not available");
    await expect(
      service.getRetroactiveMutationProgress({ projectId: "project" }),
    ).resolves.toEqual([]);
    await expect(
      service.killRetroactiveMutation({ projectId: "project", mutationId: "mutation" }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "Resolve retention through the scope cascade" */
  it("resolves policy through the project/team/organization cascade", async () => {
    const repository = new Repository();
    repository.rows = [
      {
        id: "1",
        organizationId: "org",
        scopeType: "ORGANIZATION",
        scopeId: "org",
        category: "traces",
        retentionDays: 63,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const service = createService(repository);
    await expect(
      service.getRetentionDays({ projectId: "project", category: "traces" }),
    ).resolves.toBe(63);
  });

  /** @scenario "Reject invalid retention values" */
  it("rejects unaligned retention values at the service boundary", async () => {
    const service = createService();
    await expect(
      service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: "project" },
        category: "traces",
        retentionDays: 42,
      }),
    ).rejects.toThrow();
  });

  /** @scenario "Default a missing read target" */
  it("keeps the platform default when a project has no resolvable scope", async () => {
    const repository = new Repository();
    const missingProjects = {
      ...projects,
      tryGetWithTeam: async () => null,
    } as unknown as ProjectService;
    const service = DataRetentionService.create({
      repository,
      projects: missingProjects,
      organizations,
      defaultRetentionDays: 49,
      pinRepository: new PinRepository(),
    });
    await expect(
      service.getResolvedForProject({ projectId: "missing" }),
    ).resolves.toEqual({
      traces: 49,
      scenarios: 49,
      experiments: 49,
    });
    await expect(
      service.previewScopeRemoval({
        scope: { scopeType: "PROJECT", scopeId: "missing" },
      }),
    ).resolves.toEqual({
      traces: 49,
      scenarios: 49,
      experiments: 49,
    });
  });

  /** @scenario "Resolve scope ownership through canonical services" */
  it("defaults a genuinely missing team but does not hide service failures", async () => {
    const missingOrganizations = {
      getTeamById: async () => {
        throw new TeamNotFoundError("missing");
      },
    } as unknown as OrganizationService;
    const missingService = DataRetentionService.create({
      repository: new Repository(),
      projects,
      organizations: missingOrganizations,
      defaultRetentionDays: 49,
      pinRepository: new PinRepository(),
    });
    await expect(
      missingService.previewScopeRemoval({
        scope: { scopeType: "TEAM", scopeId: "missing" },
      }),
    ).resolves.toEqual({ traces: 49, scenarios: 49, experiments: 49 });

    const unavailable = new Error("organization service unavailable");
    const failingOrganizations = {
      getTeamById: async () => {
        throw unavailable;
      },
    } as unknown as OrganizationService;
    const failingService = DataRetentionService.create({
      repository: new Repository(),
      projects,
      organizations: failingOrganizations,
      defaultRetentionDays: 49,
      pinRepository: new PinRepository(),
    });
    await expect(
      failingService.previewScopeRemoval({
        scope: { scopeType: "TEAM", scopeId: "team" },
      }),
    ).rejects.toBe(unavailable);
  });

  it("invalidates every affected project's resolved policy after writes", async () => {
    const repository = new Repository();
    const cache = new Cache();
    const service = createService(repository, cache);
    await service.setForScope({
      scope: { scopeType: "ORGANIZATION", scopeId: "org" },
      category: "traces",
      retentionDays: 63,
    });
    await service.removeForScope({
      scope: { scopeType: "ORGANIZATION", scopeId: "org" },
      category: "traces",
    });
    expect(cache.deleted).toEqual(["project", "project_2", "project", "project_2"]);
  });
});
