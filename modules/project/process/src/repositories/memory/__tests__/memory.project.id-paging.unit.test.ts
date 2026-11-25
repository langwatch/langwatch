import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../memory.project.database.ts";
import { MemoryProjectRepository } from "../memory.project.repository.ts";

const archivedAt = new Date("2026-09-01T00:00:00.000Z");

async function seeded(ids: readonly string[], archived: readonly string[] = []) {
  const memory = MemoryProjectDatabase.create();
  const repository = MemoryProjectRepository.create({ memory });
  for (const id of ids) {
    const project = await repository.create({
      id,
      name: id,
      slug: id,
      apiKey: `sk-lw-${id}`,
      teamId: "team_1",
      language: "python",
      framework: "openai",
    });
    if (archived.includes(id)) memory.putProject({ ...project, archivedAt });
  }
  return repository;
}

describe("MemoryProjectRepository id paging", () => {
  describe("given an install with three projects, one of them archived", () => {
    /** @scenario "Reads every project id when no limit is given" */
    it("reads all ids in id order, the archived one included, and no next cursor", async () => {
      const repository = await seeded(["project_c", "project_a", "project_b"], ["project_b"]);

      expect(await repository.listAllIds()).toEqual({
        ids: ["project_a", "project_b", "project_c"],
        next: null,
      });
    });
  });

  describe("given an install with three projects", () => {
    /** @scenario "Reads a page of project ids and the cursor that continues it" */
    it("reads a page and names its last id as the next cursor", async () => {
      const repository = await seeded(["project_c", "project_a", "project_b"]);

      expect(await repository.listAllIds({ limit: 2 })).toEqual({
        ids: ["project_a", "project_b"],
        next: "project_b",
      });
    });

    /** @scenario "Continues the project ids after a cursor" */
    it("continues after the cursor and ends with a null next", async () => {
      const repository = await seeded(["project_c", "project_a", "project_b"]);

      expect(await repository.listAllIds({ after: "project_b", limit: 2 })).toEqual({
        ids: ["project_c"],
        next: null,
      });
    });
  });

  describe("given an install with no projects", () => {
    /** @scenario "An install with no projects yields an empty page of ids" */
    it("yields an empty page", async () => {
      expect(await (await seeded([])).listAllIds()).toEqual({ ids: [], next: null });
    });
  });
});
