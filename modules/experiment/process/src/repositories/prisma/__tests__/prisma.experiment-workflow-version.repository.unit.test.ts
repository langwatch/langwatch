/**
 * The workflow-version lookup shown in run listings. Reads Postgres while runs come from
 * ClickHouse; returns absent for unknown ids even when they appear many times.
 */

import { describe, expect, it } from "vitest";

import { PrismaExperimentWorkflowVersionRepository } from "../prisma.experiment-workflow-version.repository.ts";

type FindManyArgs = {
  where: { projectId: string; id: { in: string[] } };
  select: Record<string, unknown>;
};

function repositoryOver(rows: Record<string, unknown>[]) {
  const calls: FindManyArgs[] = [];
  const database = {
    workflowVersion: {
      findMany: async (args: FindManyArgs) => {
        calls.push(args);
        return rows;
      },
    },
  };

  return {
    calls,
    repository: PrismaExperimentWorkflowVersionRepository.create(database as never),
  };
}

const VERSION = {
  id: "version-1",
  version: "3",
  commitMessage: "tighten the judge",
  author: { name: "A Reviewer", image: null },
};

describe("PrismaExperimentWorkflowVersionRepository", () => {
  describe("given no version ids", () => {
    describe("when the lookup runs", () => {
      it("answers without asking the database", async () => {
        const { repository, calls } = repositoryOver([VERSION]);

        const found = await repository.findByIds({ projectId: "project-1", versionIds: [] });

        expect(found).toEqual({});
        expect(calls).toHaveLength(0);
      });
    });
  });

  describe("given the same id repeated across a listing's runs", () => {
    describe("when the lookup runs", () => {
      it("asks for it once", async () => {
        const { repository, calls } = repositoryOver([VERSION]);

        await repository.findByIds({
          projectId: "project-1",
          versionIds: ["version-1", "version-1", "version-2", "version-1"],
        });

        expect(calls[0]?.where.id.in).toEqual(["version-1", "version-2"]);
      });
    });
  });

  describe("given a project", () => {
    describe("when the lookup runs", () => {
      it("scopes the read to it, so another project's versions cannot be read", async () => {
        const { repository, calls } = repositoryOver([]);

        await repository.findByIds({ projectId: "project-1", versionIds: ["version-1"] });

        expect(calls[0]?.where.projectId).toBe("project-1");
      });

      it("selects the author's name and image rather than the whole user", async () => {
        const { repository, calls } = repositoryOver([]);

        await repository.findByIds({ projectId: "project-1", versionIds: ["version-1"] });

        expect(calls[0]?.select).toEqual({
          id: true,
          version: true,
          commitMessage: true,
          author: { select: { name: true, image: true } },
        });
      });
    });
  });

  describe("given rows come back", () => {
    describe("when the lookup returns", () => {
      it("keys them by version id", async () => {
        const { repository } = repositoryOver([VERSION]);

        const found = await repository.findByIds({
          projectId: "project-1",
          versionIds: ["version-1"],
        });

        expect(found).toEqual({ "version-1": VERSION });
      });
    });

    describe("when an asked-for id has no row", () => {
      it("leaves it absent rather than mapping it to null", async () => {
        const { repository } = repositoryOver([VERSION]);

        const found = await repository.findByIds({
          projectId: "project-1",
          versionIds: ["version-1", "version-missing"],
        });

        expect(Object.hasOwn(found, "version-missing")).toBe(false);
      });
    });
  });
});
