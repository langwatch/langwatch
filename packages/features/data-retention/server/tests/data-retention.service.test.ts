import { describe, expect, it } from "vitest";
import type { RetentionPolicy } from "@langwatch/data-retention-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService, ProjectWithTeam } from "@langwatch/project-contract";
import { DataRetentionRepository } from "../src/repositories/data-retention.repository";
import { DataRetentionService } from "../src/services/data-retention.service";

class Repository extends DataRetentionRepository {
  rows: RetentionPolicy[] = [];
  async findForScopes() { return this.rows; }
  async findAllInOrganization() { return this.rows; }
  async tryFindById() { return null; }
  async upsertForScope(input: { organizationId: string; scope: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }; category: "traces" | "scenarios" | "experiments"; retentionDays: number }) { return { id: "policy", organizationId: input.organizationId, scopeType: input.scope.scopeType, scopeId: input.scope.scopeId, category: input.category, retentionDays: input.retentionDays, createdAt: new Date(), updatedAt: new Date() }; }
  async deleteForScope() {}
}

const project = {
  id: "project",
  teamId: "team",
  team: { organizationId: "org" },
} as ProjectWithTeam;

const projects = {
  getWithTeam: async () => project,
  tryGetWithTeam: async () => project,
} as unknown as ProjectService;

const organizations = {
  getTeamById: async () => ({ id: "team", organizationId: "org" }),
} as unknown as OrganizationService;

const createService = (repository = new Repository()) =>
  DataRetentionService.create({
    repository,
    projects,
    organizations,
    defaultRetentionDays: 49,
  });

describe("DataRetentionService", () => {
  it("resolves policy through the project/team/organization cascade", async () => {
    const repository = new Repository();
    repository.rows = [{ id: "1", organizationId: "org", scopeType: "ORGANIZATION", scopeId: "org", category: "traces", retentionDays: 63, createdAt: new Date(), updatedAt: new Date() }];
    const service = createService(repository);
    await expect(service.getRetentionDays({ projectId: "project", category: "traces" })).resolves.toBe(63);
  });

  it("rejects unaligned retention values at the service boundary", async () => {
    const service = createService();
    await expect(service.setForScope({ scope: { scopeType: "PROJECT", scopeId: "project" }, category: "traces", retentionDays: 42 })).rejects.toThrow();
  });
});
