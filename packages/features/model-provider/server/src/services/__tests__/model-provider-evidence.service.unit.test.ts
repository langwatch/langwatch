/**
 * The setup checklist's provider step, read through this feature's own
 * persistence.
 *
 * Two things are pinned here and they are different failures. The CASCADE — a
 * provider attached at the organization counts toward every project under it —
 * is the answer the step gets wrong when it matches the project scope alone.
 * The COLUMNS the read selects are what keeps the question answerable without
 * the deployment's cipher: an id, never `customKeys`.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { PostgresModelProviderEvidenceAdapter } from "../../adapters/postgres.model-provider-evidence.adapter";
import { ModelCostProjectPort } from "../../ports/model-provider.port";

const PROJECT_ID = "project-1";
const TEAM_ID = "team-1";
const ORGANIZATION_ID = "organization-1";

/** One project, read with its team, as the scope derivation asks for it. */
class TestProjects extends ModelCostProjectPort {
  constructor(private readonly project: ProjectWithTeam | null) {
    super();
  }

  async tryGetWithTeam(): Promise<ProjectWithTeam | null> {
    return this.project;
  }

  async getWithTeam(): Promise<ProjectWithTeam> {
    if (!this.project) throw new Error("no project");
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
    database: { modelProvider: { findFirst } } as unknown as Pick<PrismaClient, "modelProvider">,
  };
}

describe("ModelProviderEvidenceService", () => {
  describe("given a project whose organization holds an enabled provider", () => {
    /**
     * The read that answers the setup checklist's provider step is this
     * feature's, so the `where` it issues is one place and the columns it
     * selects are governed by the same rules as every other read of this
     * table. It selects an id: a credential column never leaves the database
     * to answer a boolean.
     */
    it("matches the project, team and organization scopes without selecting a credential", async () => {
      const { findFirst, database } = testDatabase({ id: "provider-1" });
      const evidence = PostgresModelProviderEvidenceAdapter.create({
        database,
        projects: new TestProjects(project),
      }).build();

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
      const evidence = PostgresModelProviderEvidenceAdapter.create({
        database,
        projects: new TestProjects(project),
      }).build();

      await expect(evidence.hasEnabledProvider({ projectId: PROJECT_ID })).resolves.toBe(false);
    });
  });

  describe("given a project that cannot be read", () => {
    it("answers false rather than reading every provider in the deployment", async () => {
      const { findFirst, database } = testDatabase({ id: "provider-1" });
      const evidence = PostgresModelProviderEvidenceAdapter.create({
        database,
        projects: new TestProjects(null),
      }).build();

      await expect(evidence.hasEnabledProvider({ projectId: PROJECT_ID })).resolves.toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe("given a blank project id", () => {
    it("refuses rather than widening the scope filter", async () => {
      const { database } = testDatabase({ id: "provider-1" });
      const evidence = PostgresModelProviderEvidenceAdapter.create({
        database,
        projects: new TestProjects(project),
      }).build();

      await expect(evidence.hasEnabledProvider({ projectId: "" })).rejects.toThrow();
    });
  });
});
