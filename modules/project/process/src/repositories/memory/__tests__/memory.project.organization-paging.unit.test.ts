import type { Team } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../memory.project.database.ts";
import { MemoryProjectRepository } from "../memory.project.repository.ts";

const at = new Date("2026-09-01T00:00:00.000Z");

function team({ id, organizationId }: { id: string; organizationId: string }): Team {
  return {
    id,
    name: id,
    slug: id,
    organizationId,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  };
}

/** project_a and project_c sit in org_1, project_b in org_2; project_b is archived. */
async function seeded({ empty = false }: { empty?: boolean } = {}) {
  const memory = MemoryProjectDatabase.create();
  memory.putTeam(team({ id: "team_1", organizationId: "org_1" }));
  memory.putTeam(team({ id: "team_2", organizationId: "org_2" }));
  const repository = MemoryProjectRepository.create({ memory });
  const rows: [string, string][] = [
    ["project_c", "team_1"],
    ["project_a", "team_1"],
    ["project_b", "team_2"],
  ];
  for (const [id, teamId] of empty ? [] : rows) {
    const project = await repository.create({
      id,
      name: id,
      slug: id,
      apiKey: `sk-lw-${id}`,
      teamId,
      language: "python",
      framework: "openai",
    });
    if (id === "project_b") memory.putProject({ ...project, archivedAt: at });
  }
  return repository;
}

const a = { id: "project_a", organizationId: "org_1" };
const b = { id: "project_b", organizationId: "org_2" };
const c = { id: "project_c", organizationId: "org_1" };

describe("MemoryProjectRepository project and organisation paging", () => {
  describe("given an install with three projects in two organisations, one of them archived", () => {
    /** @scenario "Reads every project with its organisation when no limit is given" */
    it("reads all in id order with their organisation, the archived one included", async () => {
      const repository = await seeded();

      expect(await repository.listAllWithOrganization()).toEqual({
        projects: [a, b, c],
        next: null,
      });
    });

    /** @scenario "Reads a page of projects with their organisation and the cursor that continues it" */
    it("reads a page and names its last id as the next cursor", async () => {
      const repository = await seeded();

      expect(await repository.listAllWithOrganization({ limit: 2 })).toEqual({
        projects: [a, b],
        next: "project_b",
      });
    });

    /** @scenario "Continues the projects with their organisation after a cursor" */
    it("continues after the cursor and ends with a null next", async () => {
      const repository = await seeded();

      expect(await repository.listAllWithOrganization({ after: "project_b", limit: 2 })).toEqual({
        projects: [c],
        next: null,
      });
    });
  });

  describe("given an install with no projects", () => {
    /** @scenario "An install with no projects yields an empty page of projects" */
    it("yields an empty page", async () => {
      const repository = await seeded({ empty: true });

      expect(await repository.listAllWithOrganization()).toEqual({ projects: [], next: null });
    });
  });
});
