import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { PostgresModelCostCatalogAdapter } from "../postgres.model-cost-catalog.adapter";

/**
 * Spec: packages/features/model-provider/specs/model-cost-catalog-seam.feature
 *
 * The cost listing record-time enrichment reads. `ModelProviderService`
 * requires nine collaborators — an organization service, an authz service, a
 * catalog, a translation port, an id service, a credential codec, a Codex
 * token refresher and a connection rate limiter — because writing a cost
 * authorizes a scope and every credential path decrypts a key. This read asks
 * none of them anything.
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
    tryGetWithTeam: vi.fn(async () =>
      options.project === undefined ? projectWithTeam() : options.project,
    ),
    getWithTeam: vi.fn(async () => projectWithTeam()),
  };

  return {
    findMany,
    projects,
    built: PostgresModelCostCatalogAdapter.create({
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
