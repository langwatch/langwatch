import { ProjectNotFoundError, type ProjectWithTeam } from "@langwatch/project-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
/**
 * The setup checklist's provider step, read through this feature's own
 * persistence.
 */
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { ModelCostProject } from "../app/model-provider.members.ts";
import { PrismaModelProviderEvidenceRepository } from "../repositories/prisma/prisma.model-provider-evidence.repository.ts";
import { ModelProviderEvidenceService } from "../services/model-provider-evidence.service.ts";
import { ModelProviderProjectScopeService } from "../services/model-provider-project-scope.service.ts";

const PROJECT_ID = "project-1";
const TEAM_ID = "team-1";
const ORGANIZATION_ID = "organization-1";

/** One project, read with its team, as the scope derivation asks for it. */
class TestProjects extends ModelCostProject {
  constructor(private readonly project: ProjectWithTeam | null) {
    super();
  }

  async findWithTeam(): Promise<ProjectWithTeam | null> {
    return this.project;
  }

  async getWithTeam(): Promise<ProjectWithTeam> {
    if (!this.project) throw new ProjectNotFoundError();
    return this.project;
  }
}

const project = {
  id: PROJECT_ID,
  teamId: TEAM_ID,
  team: { organizationId: ORGANIZATION_ID },
} as unknown as ProjectWithTeam;

function testDatabase(row: { id: string } | null) {
  const findFirst = vi.fn(async () => row);
  return {
    findFirst,
    database: prismaDouble({ modelProvider: { findFirst } }),
  };
}

describe("ModelProviderEvidenceService", () => {
  describe("given a project whose organization holds an enabled provider", () => {
    /** Selects only an id — a credential column never leaves the database to answer a boolean. */
    it("matches the project, team and organization scopes without selecting a credential", async () => {
      const { findFirst, database } = testDatabase({ id: "provider-1" });
      const evidence = ModelProviderEvidenceService.create({
        providers: PrismaModelProviderEvidenceRepository.create(database),
        scopes: ModelProviderProjectScopeService.create({ projects: new TestProjects(project) }),
      });

      await expect(evidence.hasEnabledProvider({ projectId: PROJECT_ID })).resolves.toBe(true);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          enabled: true,
          scopes: {
            some: {
              OR: [
                { scopeType: "PROJECT", scopeId: PROJECT_ID },
                { scopeType: "TEAM", scopeId: TEAM_ID },
                { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
              ],
            },
          },
        },
        select: { id: true },
      });
    });
  });

  describe("given a project with no provider attached anywhere in its cascade", () => {
    it("reports the step as not started", async () => {
      const { database } = testDatabase(null);
      const evidence = ModelProviderEvidenceService.create({
        providers: PrismaModelProviderEvidenceRepository.create(database),
        scopes: ModelProviderProjectScopeService.create({ projects: new TestProjects(project) }),
      });

      await expect(evidence.hasEnabledProvider({ projectId: PROJECT_ID })).resolves.toBe(false);
    });
  });

  describe("given a project that cannot be read", () => {
    it("answers false rather than reading every provider in the deployment", async () => {
      const { findFirst, database } = testDatabase({ id: "provider-1" });
      const evidence = ModelProviderEvidenceService.create({
        providers: PrismaModelProviderEvidenceRepository.create(database),
        scopes: ModelProviderProjectScopeService.create({ projects: new TestProjects(null) }),
      });

      await expect(evidence.hasEnabledProvider({ projectId: PROJECT_ID })).resolves.toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe("given a blank project id", () => {
    it("refuses rather than widening the scope filter", async () => {
      const { database } = testDatabase({ id: "provider-1" });
      const evidence = ModelProviderEvidenceService.create({
        providers: PrismaModelProviderEvidenceRepository.create(database),
        scopes: ModelProviderProjectScopeService.create({ projects: new TestProjects(project) }),
      });

      await expect(evidence.hasEnabledProvider({ projectId: "" })).rejects.toThrow(ZodError);
    });
  });
});
