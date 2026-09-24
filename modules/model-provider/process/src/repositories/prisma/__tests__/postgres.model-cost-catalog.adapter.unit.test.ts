import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { PrismaModelCostCatalogRepository } from "../../../model-provider.server.ts";

/**
 * Spec: modules/model-provider/specs/model-cost-catalog-seam.feature
 * The cost listing's record-time enrichment reads, which unlike a write need none of
 * `ModelProviderApi`'s nine collaborators (authz, catalog, credential codec, etc).
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");

function costRow() {
  return {
    id: "cost-1",
    organizationId: "organization-1",
    projectId: "project-1",
    scopeType: "PROJECT",
    scopeId: "project-1",
    model: "acme-1",
    regex: "^acme-1$",
    inputCostPerToken: 0.001,
    outputCostPerToken: 0.002,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function projectWithTeam() {
  return {
    id: "project-1",
    teamId: "team-1",
    team: { organizationId: "organization-1" },
  };
}

function catalogue(options: { project?: unknown } = {}) {
  const findMany = vi.fn(async () => [costRow()]);
  const projects = {
    findWithTeam: vi.fn(async () =>
      options.project === undefined ? projectWithTeam() : options.project,
    ),
    getWithTeam: vi.fn(async () => {
      if (options.project === null) throw new ProjectNotFoundError();
      return options.project ?? projectWithTeam();
    }),
  };

  return {
    findMany,
    projects,
    built: PrismaModelCostCatalogRepository.create({
      database: { customLLMModelCost: { findMany } } as unknown as PrismaClient,
      projects: projects as never,
    }).build(),
  };
}

describe("PostgresModelCostCatalogAdapter", () => {
  describe("given a Prisma client and one project read", () => {
    describe("when a project's costs are listed", () => {
      /** @scenario "The cost catalogue composes from a database and one project read" */
      it("reads the rules stored under all three of the project's scopes", async () => {
        const { built, findMany } = catalogue();

        await expect(built.listCosts({ projectId: "project-1" })).resolves.toEqual([
          expect.objectContaining({ id: "cost-1", inputCostPerToken: 0.001 }),
        ]);
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              OR: [
                { scopeType: "PROJECT", scopeId: "project-1" },
                { scopeType: "TEAM", scopeId: "team-1" },
                { scopeType: "ORGANIZATION", scopeId: "organization-1" },
              ],
            },
          }),
        );
      });

      /** @scenario "A project that cannot be read prices nothing rather than failing" */
      it("answers an empty list and reads no cost row", async () => {
        const { built, findMany } = catalogue({ project: null });

        await expect(built.listCosts({ projectId: "project-1" })).resolves.toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
      });
    });
  });
});
