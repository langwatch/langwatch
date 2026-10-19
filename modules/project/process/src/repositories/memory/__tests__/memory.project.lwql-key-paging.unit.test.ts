import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../memory.project.database.ts";
import { MemoryProjectRepository } from "../memory.project.repository.ts";

const at = new Date("2026-09-01T00:00:00.000Z");

/** project_a, project_b and project_c in one team; project_b is archived. */
async function seeded() {
  const memory = MemoryProjectDatabase.create();
  memory.putTeam({
    id: "team_1",
    name: "team_1",
    slug: "team_1",
    organizationId: "org_1",
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  });
  const repository = MemoryProjectRepository.create({ memory });
  for (const id of ["project_c", "project_a", "project_b"]) {
    const project = await repository.create({
      id,
      name: id,
      slug: id,
      apiKey: `sk-lw-${id}`,
      teamId: "team_1",
      language: "python",
      framework: "openai",
    });
    if (id === "project_b") memory.putProject({ ...project, archivedAt: at });
  }
  return repository;
}

describe("MemoryProjectRepository LangWatchQL key paging", () => {
  describe("given an install with three projects, one of them archived", () => {
    /** @scenario "Reads every project with its LangWatchQL key when no limit is given" */
    it("reads all in id order with their key, the archived one included", async () => {
      const repository = await seeded();
      expect(await repository.listLwqlKeys()).toEqual({
        projects: [
          { id: "project_a", lwqlKey: "lwql-project_a" },
          { id: "project_b", lwqlKey: "lwql-project_b" },
          { id: "project_c", lwqlKey: "lwql-project_c" },
        ],
        next: null,
      });
    });

    /** @scenario "Reads a page of projects with their LangWatchQL key and the cursor that continues it" */
    it("continues after the cursor and names the next one", async () => {
      const repository = await seeded();
      expect(await repository.listLwqlKeys({ after: "project_a", limit: 1 })).toEqual({
        projects: [{ id: "project_b", lwqlKey: "lwql-project_b" }],
        next: "project_b",
      });
    });
  });
});
